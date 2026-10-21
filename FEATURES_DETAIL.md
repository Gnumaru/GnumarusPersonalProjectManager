# Features Detail

This document explains how every implemented feature works, with pointers to the
code that implements it.

---

## 1. The task file format

**Files:** `src/core/task.ts`

A task is a single plain text file named `task_<id>.txt` inside the project
folder. The file starts with a metadata block made of `key=value` lines, exactly
like an `.ini` file, and the block is terminated by a line containing only four
hyphens. Everything after that line is the description, which is free text.

```
id=12
title=Implement pagination
status=todo
tags=frontend ui
created=2026-10-20T10:00:00.000Z
updated=2026-10-20T10:00:00.000Z
----
The description of the task.
It can have as many lines as needed.
```

Rules:

* `id` - unique incremental integer, also encoded in the file name.
* `title` - mandatory, single line (new lines are replaced by spaces on write).
* `status` - one of `todo`, `doing`, `done`. Anything else falls back to `todo`.
* `parent` - **absent for a root task**. Present only for a child task, holding
  the id of its parent. The parser and the writer already support it, the user
  interface does not expose it yet.
* `tags` - the tags separated by white spaces. A tag can never contain a white
  space, so white space is an unambiguous separator. Duplicated tags are removed
  while the original order is kept.
* `created` / `updated` - ISO 8601 timestamps.

Parsing is tolerant: a file without a separator keeps its `key=value` lines as
metadata and uses the remaining lines as the description; Windows line endings
are handled; a `----` line inside the description is kept as part of the text.

The functions `parseTask` and `serializeTask` are pure and are covered by unit
tests, including a round trip test.

---

## 2. Listing, pagination and memory usage

**Files:** `src/core/pagination.ts`, `src/core/taskRepository.ts`, `src/ui/paginationBar.ts`

* The page size is **10 tasks per page** (`DEFAULT_PAGE_SIZE`).
* The repository first resolves the *paths* of the matching task files, slices
  the requested page out of that list and only then reads the files of the
  page. The files of the previous page are released as soon as the new page is
  loaded, so at most ten task files are held in memory.
* The pagination bar shows the four buttons required by the specification:
  **first page**, **previous page**, **next page** and **last page**, plus the
  counter (`Page 2 of 5`) and the summary (`Showing 11-20 of 47`).
* The buttons are disabled when they would not change the page, and the page
  number is clamped to the available range, so a deletion on the last page
  cannot leave the user on an empty page.

`totalPages`, `clampPage`, `computePageInfo` and `pageSlice` are pure functions
with their own unit tests.

---

## 3. Search

**Files:** `src/core/taskRepository.ts`

The search is a **recursive grep** executed by the bridge service:

```
grep -rIl --fixed-strings --ignore-case --include='task_*.txt' \
    --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg -f - .
```

* The pattern is sent through **stdin** (`-f -`), never through the command
  line, so no quoting or escaping problem can happen whatever the user types.
* The search is **case insensitive** and looks at the whole file, so it matches
  the title, the tags and the description.
* `grep` exits with `1` when nothing matched; that is not an error and yields an
  empty result.
* An empty search box lists every task (the listing uses `find`).

The listing uses the same recursive behaviour, so a task file inside a
subfolder of the project is found as well:

```
find . -type f -name 'task_*.txt' -not -path '*/.git/*' ... -print
```

---

## 4. Creating, editing, viewing and deleting

**Files:** `src/ui/taskDialog.ts`, `src/core/taskRepository.ts`, `src/api/client.ts`

| Action | What happens |
| ------ | ------------ |
| Create | The next free id is computed from the highest existing `task_<id>.txt`, the file is written with `POST /api/file`. If the file already exists the id is increased and the write is retried. A child task also receives the `parent=<id>` key. |
| Edit | The file is read, the user input is applied (id, parent and creation time are kept), the update timestamp is refreshed and the file is overwritten with `PUT /api/file`. |
| View | A read only dialog shows the status, the tags, the timestamps, the description and the children of the task. |
| Delete | The file is removed with `DELETE /api/file` after an explicit confirmation ("Delete this task permanently? Yes, delete / Keep it"). |

The dialog works in three modes (`view`, `edit`, `create`) and validates the
title before saving. Errors raised by the service are shown inside the dialog
instead of closing it.

---

## 5. Child tasks

**Files:** `src/core/taskRepository.ts`, `src/ui/taskTable.ts`, `src/ui/taskDialog.ts`

A task can have **0 or 1 parent**. The link is stored in the metadata of the
child file:

```
id=13
title=Write the migrations
status=todo
parent=1
tags=backend
created=2026-10-20T10:00:00.000Z
updated=2026-10-20T10:00:00.000Z
----
Create the migration files.
```

### Creating a child

Two entry points, both open the same dialog:

* the **child button** of every row of the table (the third action button);
* the **Add child task** button of the read only view of a task.

The dialog shows a banner with the parent (`New child of task #1 - Design the
database schema`), so it is impossible to create a child without knowing which
task it belongs to. When the file is written, the `parent=<id>` key is added
and the id is allocated exactly like for a root task.

The repository refuses to create a child of a task that does not exist
(`The parent task #9999 does not exist in "<folder>".`).

### Seeing the relations

| Where | What is shown |
| ----- | ------------- |
| The **Parent** column of the table | `#1` for a child task (a link that opens the parent, even when the parent is on another page), `—` for a root task. |
| The **title of a task** | A badge with the amount of children it has. |
| The **view of a task** | The list of its children (`#2 Write the migrations - To do`); clicking a child opens it. |
| The **view and the editor of a child** | A banner with the parent of the task. |

The amount of children of every task is read with a single command that only
looks at the `parent=` keys, so the content of the files never reaches the
browser:

```
grep -rh --include='task_*.txt' ... '^parent=' . | cut -d= -f2 | sort | uniq -c
```

The children of one task are listed with:

```
grep -rl --include='task_*.txt' ... -e '^parent=<id>$' .
```

Both commands are executed by the bridge service, in the project folder.

The hierarchy is one level deep in the flat list (the format would allow
more), and the search, the pagination and the listing treat the children like
any other task. The **tree view** shows the whole hierarchy.

---

## 5 bis. The tree view

**Files:** `src/core/taskTree.ts`, `src/core/taskRepository.ts`, `src/ui/taskTreeView.ts`, `src/ui/treeDrag.ts`, `src/ui/app.ts`

The toolbar holds a **List / Tree** toggle. The flat list stays exactly as it
was; the tree is the second way of showing the tasks.

### What a row shows

Every task is one row with:

* a **twisty** (`▸` / `▾`) that collapses and expands the children of the task
  (it is disabled when the task has no child),
* the **name** of the task, which opens the read only view of the task,
* the **tags** of the task,
* the **actions**: focus the tree on the task, view it, edit it and add a child.

The indentation of a row is the depth of the task in the displayed tree.

### Collapsing and expanding

| Gesture | Effect |
| ------- | ------ |
| **Simple click** on the twisty | Only the task changes: a child that was collapsed stays collapsed, a child that was expanded stays expanded. The state of the branch is remembered. |
| **Ctrl+click** on the twisty | The **whole branch** is collapsed or expanded: the task and every one of its descendants, at any depth. |

The tooltip of the twisty tells which gesture does what.

### The focus

The tree can be focused on a task: that task becomes the root of the displayed
tree and every task that is not part of its hierarchy is hidden. The **general
root** (the first item of the breadcrumb) brings back every task that has no
parent. The breadcrumb shows the chain of the focused task, from the general
root down to it, and every ancestor can be focused in one click.

### Where the data comes from

The structure of the tasks is read with **one** command that only looks at the
`parent=` lines, together with the listing of the task files (the id of a task
is encoded in its file name):

```
grep -rH --include='task_*.txt' ... -e '^parent=' .
./task_2.txt:parent=1
./nested/task_3.txt:parent=2
```

The content of the files never reaches the browser here. The **files of the
displayed rows only** are read afterwards (a few at a time), to get the title
and the tags of the tasks that are on the screen: the memory holds the tree
that is displayed and nothing else.

### The rules of the tree

`src/core/taskTree.ts` is pure and covered by unit tests:

* a task whose **parent does not exist** (a deleted parent, a task moved to
  another folder) becomes a **root**: it would otherwise never be displayed;
* a **cycle** in the `parent=` keys (`a` is the parent of `b` and `b` is the
  parent of `a`) is broken: the task that closes the cycle becomes a root;
* the traversal remembers the ids of the current path, so a cycle can never
  make it loop forever.

### Drag and drop

A task can be **dragged onto another task** to become its child. The `parent=`
key of its file is rewritten and the task leaves its previous parent:

```
A          A
-B    -->  -B
--C        --C
-D         ---E
--E        -D
```

The drag is driven by the mouse (and not by the native HTML5 drag and drop) so
that the application controls the whole feedback:

* the dragged row is **dimmed**;
* the row under the pointer is **highlighted** (it is the drop target);
* a **chip** with the name of the task follows the pointer;
* the click that ends the drag is swallowed, so no dialog opens by accident.

A simple click is not a drag: the pointer has to travel a few pixels
(`DRAG_THRESHOLD_PX`) before the drag starts, so the name of the task still
opens the task and the twisty still expands it. The twisty and the actions of
the row never start a drag.

A task can **never** become a child of one of its own descendants: that would
build a cycle, so the move is refused with a message and the file is left
alone.

### The search

The search uses the same recursive `grep` as the flat list. In the tree, only
the branches that hold a match are kept and the ancestors of the matches are
expanded, so a match is never hidden behind a collapsed task.

---

## 6. The bridge service

**Files:** `src/api/client.ts`, `src/ui/app.ts`

* The base URL is `http://127.0.0.1:1423`.
* Every endpoint except `/api/help` may need the token generated when the
  service starts. The user pastes it in the **API token** dialog of the top bar;
  the token is kept in `localStorage` (ephemeral data, the same nature as the
  RAM of a desktop application).
* The service uses a tagged convention on the wire (`i:12`, `f:1.5`, `b:true`,
  `null`); the client decodes it in `decodeTagged` and encodes the numbers it
  sends back with `encodeTaggedNumber`.
* When the service cannot be reached, a banner explains the situation and the
  application pings it **every five seconds**; when the service comes back the
  application reloads the configuration and the tasks by itself.
* A rejected token shows a dedicated banner and opens the token dialog.

### The token is optional

The service can be started with the flag that **disables the token
requirement**. The application discovers it and never asks for a token in that
case:

1. `GET /api/help` publishes an `auth` block whose `required` field is a
   tagged boolean. `b:false` means "no token needed", `b:true` means "a token is
   needed". The field is decoded by `parseServiceInfo`.
2. When the help page does not publish the policy, a **protected route is
   probed without any token**: `GET /api/sysinfo` first (read only, no
   parameter) and then `POST /api/shell` with a harmless `echo`. A `401` answer
   means the token is required, a successful answer means it is not.
3. When nothing can be determined, the application behaves conservatively and
   asks for the token.

`ApiClient.fetchServiceStatus` returns everything the application needs in one
call: the availability of the service, the authentication policy and the
version of the service. The application calls it on every service check (every
five seconds), so a service restarted with the opposite policy is noticed
without reloading the page.

What the application does with the policy:

* The **API token** button of the top bar is **hidden** when the token is not
  needed (there is nothing for the user to type).
* The folder picker opens directly, without the token dialog.
* The configuration file is read even when there is no token.
* The tooltip of the status pill describes the current policy.
* A `401` answer re-reads the policy before the token dialog is shown: the
  user is only asked for a token when the service really needs one.

---

## 7. Configuration file

**Files:** `src/core/config.ts`

The selected project folder and the page size are stored in
`~/.config/GnumarusProjectManager/config.json`, written through the bridge
service, so the choice survives a browser cache wipe and can be shared by
different browsers. The browser only stores the token, which changes every time
the service restarts, and only when the service demands one.

---

## 8. The folder picker

**Files:** `src/ui/fileDialog.ts`

A dialog that behaves like the file dialogs of an operating system:

* **Back** and **forward** through the navigation history.
* **Up** to the parent folder.
* The **root** of the file system and the **drives** (the real mount points,
  read from `/proc/mounts`, pseudo file systems filtered out).
* The **home** folder and the usual `Desktop`, `Documents`, `Downloads` and
  `Pictures` folders (read from `~/.config/user-dirs.dirs`).
* A **path box**: type a path and press `Enter` or `Go`.
* **New folder**: creates the directory and enters it.
* Double click a folder to enter it, single click to select it.
* **Enter** enters the selected folder, whatever has the focus (a row of the
  list, the path box and the name of the new folder keep their own meaning).

Clicking an item of the list only changes the class of the rows: the list is
**not** rebuilt, so the scroll of the dialog stays where it was and a folder can
be entered with a double click.

---

## 9. Layout and responsiveness

**Files:** `src/styles.css`, `src/ui/app.ts`

* The window is split into a top bar, an optional banner, a toolbar, the task
  table (the only scrolling area) and the pagination bar: no vertical space is
  wasted and the table always fills the window.
* The interface is designed for a desktop (1366x768 and above) with the mouse
  and the keyboard, and it adapts to narrower or shorter windows (the tag
  column and the updated column disappear first, the toolbar wraps).
* Both colour schemes are supported (`prefers-color-scheme`).
* Shortcuts: `Ctrl+F` focuses the search box, `Enter` searches, `Escape`
  clears the search, `Escape` closes a dialog.

---

## 10. Tests

| Suite | What it covers |
| ----- | -------------- |
| `src/core/task.test.ts` | Format, parsing, serialization, round trip, tags, moving a task under another parent. |
| `src/core/pagination.test.ts` | Page count, clamping, slicing, page information. |
| `src/core/taskTree.test.ts` | The tree of the tasks: roots, children, orphan tasks, cycles, focus, expansion, search and subtree of a task. |
| `src/core/config.test.ts` | Configuration parsing and serialization. |
| `src/api/client.test.ts` | Tagged values, headers, error handling, shell calls, authentication policy of the service (mocked `fetch`). |
| `src/core/taskRepository.test.ts` | The repository against the **running bridge**: creation, listing, pagination, recursive search, update, deletion, creation of a child task, counting and listing of the children, reading of the hierarchy. Skipped when the service is unreachable, or when it demands a token that is not in `GNUMARUS_API_TOKEN`. |
| `src/ui/widgets.test.ts` | The task table (parent column, children badge, action buttons) and the pagination bar (jsdom). |
| `src/ui/app.test.ts` | The whole application against an in memory fake of the service (jsdom), including the creation of a child task, the navigation between the parent and its children, the optional token and the tree view. |
| `src/ui/treeDrag.test.ts` | The drag and drop of the rows of the tree: the drop target, the thresholds, the buttons that never start a drag and the click that ends the drag. |
| `src/ui/fileDialog.test.ts` | Path helpers, sorting of the file list, the picker itself: the list is not rebuilt when an item is selected and `Enter` enters the selected folder. |
| `scripts/e2e-smoke.sh` | The built application is rendered by a headless Chrome at the domain root and at a nested path. |
| `scripts/e2e-browser.mjs` | A real browser drives the application: pagination, search, creation, edition, deletion and the tree view, checked against the files on disk. |

Commands:

```bash
npm test            # the unit and integration test suites
npm run e2e         # the headless render test
npm run e2e:browser # the browser end to end test
npm run verify      # everything, in order
```

---

## 11. Deployment

**File:** `scripts/deploy.mjs`

`npm run deploy` builds the application and copies `dist` to
`/var/www/html/GnumarusProjectManager`, replacing the previous copy. The
application is built with `base: './'`, so the relative asset URLs work at the
domain root (`http://localhost/`) and at any nested path
(`http://localhost/my/web/app/path`).
