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
created=20261020100000000
updated=20261020100000000
start=
end=
blocked_by=3,5
related=7,9
----
The description of the task.
It can have as many lines as needed.
```

Rules:

* `id` - unique incremental integer, **also encoded in the file name**. The id
  inside the file is the one the application uses: the name is only a fallback
  for the files written before the key existed. The same rule holds for the
  comments (`comment_<id>.txt`) and for the notes (`note_<id>.txt`).
* `title` - mandatory, single line (new lines are replaced by spaces on write).
* `status` - one of `planning`, `next`, `todo`, `doing`, `paused`, `done`,
  `canceled`. Anything else falls back to `todo`. The badge of the task shows
  the name of the status in upper case (`PLANNING`, `NEXT`, `TODO`, `DOING`,
  `PAUSED`, `DONE`, `CANCELED`), each one with its own colour.
* `parent` - **absent for a root task**. Present only for a child task, holding
  the id of its parent. The parser and the writer already support it, the user
  interface does not expose it yet.
* `tags` - the tags separated by white spaces. A tag can never contain a white
  space, so white space is an unambiguous separator. Duplicated tags are removed
  while the original order is kept.
* `created` / `updated` - the timestamps of the creation and of the last update.
* `start` / `end` - the timestamps of the start and of the end of the task. They
  are empty when the task has not started and when it is not finished. They are
  written and read, and shown in the view of a task; they will be used by the
  features to come.
* `blocked_by` - the ids of the tasks that **block** this one: they prevent its
  completion. The key is absent when the task is not blocked.
* `related` - the ids of the tasks that are **related** to this one: a relation
  the user makes explicit, that is neither a blocking relation nor a
  parent/child relation. The key is absent when there is none.

### The blocking and the related tasks in the editor

The editor of a task holds two fields, **Blocked by** and **Related tasks**.
The user types the id of a task (or several ids separated by commas) and
presses `Enter`: each id becomes a chip that can be removed with its `×`.

A task cannot block itself nor be related to itself: the editor refuses those
ids. The relations are shown in the read only view of the task (`Blocked by` and
`Related`).

### The dates in the editor

The editor of a task holds two **date pickers** (`<input type="date">`), one
for the start date and one for the end date. They are filled with the day of the
`start=` and `end=` keys and written back in the compact format, at midnight:

```
dateInputValue('20261019100000000')  ->  '2026-10-19'   (the value of the picker)
timestampFromDateInput('2026-10-19') ->  '20261019000000000'
```

The end date cannot be before the start date: the editor refuses to save the
task and explains why.

### The timestamps

The dates are written in the **compact format** `YYYYMMDDHHNNSSIII`:

```
created=20261020100000000     ->  2026-10-20 10:00:00.000
```

The time is the **local** time of the machine: the format carries **no
timezone**, so the same moment is written differently on two machines. The
functions `formatTaskTimestamp` and `parseTaskTimestamp` do the conversion, and
`normalizeTaskTimestamp` turns an unknown value into an empty string.

The ISO 8601 format of the tasks written before the change (`created=2026-10-20T10:00:00.000Z`)
is still **read**, so their dates are not lost; they are written back in the
compact format the next time the task is saved.

Parsing is tolerant: a file without a separator keeps its `key=value` lines as
metadata and uses the remaining lines as the description; Windows line endings
are handled; a `----` line inside the description is kept as part of the text.

The functions `parseTask` and `serializeTask` are pure and are covered by unit
tests, including a round trip test.

---

## 2. Listing, pagination and memory usage

**Files:** `src/core/pagination.ts`, `src/core/projectStore.ts`, `src/ui/paginationBar.ts`

* The page size is **10 tasks per page** (`DEFAULT_PAGE_SIZE`).
* The store first resolves the *paths* of the matching task files, slices
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

**Files:** `src/core/projectStore.ts`

The search is **recursive** and looks at the whole file, so it matches the
title, the tags and the description. It is **case insensitive**.

In the **service** mode, the search is a `grep` executed by the bridge service:

```
grep -rIl --fixed-strings --ignore-case --include='task_*.txt' \
    --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg -f - .
```

* The pattern is sent through **stdin** (`-f -`), never through the command
  line, so no quoting or escaping problem can happen whatever the user types.
* `grep` exits with `1` when nothing matched; that is not an error and yields an
  empty result.

In the **embedded** mode, the shell is not available: the same search is done in
JavaScript, over the files of the storage of the browser.

An empty search box lists every task (the listing uses `find` in the service
mode, and the paths of the storage in the embedded mode).

The listing uses the same recursive behaviour, so a task file inside a
subfolder of the project is found as well:

```
find . -type f -name 'task_*.txt' -not -path '*/.git/*' ... -print
```

---

## 4. Creating, editing, viewing and deleting

**Files:** `src/ui/taskDialog.ts`, `src/core/projectStore.ts`, `src/api/client.ts`

| Action | What happens |
| ------ | ------------ |
| Create | The next free id is computed from the highest existing `task_<id>.txt`, the file is written with `POST /api/file`. If the file already exists the id is increased and the write is retried. A child task also receives the `parent=<id>` key. |
| Edit | The file is read, the user input is applied (id, parent and creation time are kept), the update timestamp is refreshed and the file is overwritten with `PUT /api/file`. |
| View | A read only dialog shows the status, the tags, the timestamps, the description and the children of the task. |
| Delete | The file is removed with `DELETE /api/file` after an explicit confirmation ("Delete this task permanently? Yes, delete / Keep it"). |

The dialog works in three modes (`view`, `edit`, `create`) and validates the
title before saving. Errors raised by the service are shown inside the dialog
instead of closing it.

The same actions work the same way with the **embedded project**: the store of
the browser writes the very same files, in the very same format.

---

## 5. Child tasks

**Files:** `src/core/projectStore.ts`, `src/ui/taskTable.ts`, `src/ui/taskDialog.ts`

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

The store refuses to create a child of a task that does not exist
(`The parent task #9999 does not exist in "<folder>".`).

### Seeing the relations

| Where | What is shown |
| ----- | ------------- |
| The **Parent** column of the table | `#1` for a child task (a link that opens the parent, even when the parent is on another page), `—` for a root task. |
| The **title of a task** | A badge with the amount of children it has. |
| The **view of a task** | The list of its children (`#2 Write the migrations - TODO`); clicking a child opens it. |
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

Both commands are executed by the bridge service, in the project folder. In the
embedded mode, the same numbers are computed in JavaScript, over the files of
the storage of the browser.

The hierarchy is one level deep in the flat list (the format would allow
more), and the search, the pagination and the listing treat the children like
any other task. The **tree view** shows the whole hierarchy.

---

## 5 bis. The tree view

**Files:** `src/core/taskTree.ts`, `src/core/projectStore.ts`, `src/ui/taskTreeView.ts`, `src/ui/treeDrag.ts`, `src/ui/app.ts`

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

A task can also be **detached from its parent**, to become a root task again.
It is enough to drop it on:

* the **general root** (the first item of the breadcrumb, above the list);
* the **empty space** below the last row of the list.

The drag is driven by the mouse (and not by the native HTML5 drag and drop) so
that the application controls the whole feedback:

* the dragged row is **dimmed**;
* the row under the pointer is **highlighted** (it is the drop target), the
  general root is highlighted the same way;
* the empty space of the list is highlighted when the task would be detached;
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

## 5 ter. The board of the tasks

**Files:** `src/core/task.ts`, `src/core/projectStore.ts`, `src/ui/kanbanBoard.ts`, `src/ui/kanbanDrag.ts`, `src/ui/app.ts`

The third display mode is a **board**: one column per status, with the cards
of the tasks that have **no child**. A task that has children is represented by
its children, the board shows the leaves of the tree.

The columns are always in the same order (`BOARD_STATUSES`):

```
PLANNING | TODO | NEXT | PAUSED | DOING | DONE | CANCELED
```

Each column carries the colour of its status and the amount of cards it holds.
A card shows the name and the tags of the task; clicking it opens the task and
the pencil opens its editor.

### Changing the status

A card is **dragged from one column to another one**: the `status=` key of its
file is rewritten and the card moves to its new column. The column under the
pointer is highlighted, the dragged card is dimmed and a chip with the name of
the task follows the pointer.

### Where the data comes from

The whole board costs **two** round trips and reads no file at all:

```
GET  (find)      every task file below the project folder  -> the ids
POST /api/shell  grep -rH -e '^id=' -e '^parent=' -e '^status=' -e '^title=' -e '^tags=' .
```

The command returns the parent, the status, the title and the tags of every
task. The tasks that are the parent of another task are left out: they are not
cards of the board.

---

## 5 quater. The Gantt chart

**Files:** `src/core/gantt.ts`, `src/core/projectStore.ts`, `src/ui/ganttView.ts`, `src/ui/app.ts`

The fourth display mode is a **Gantt chart**. The window is split in two:

* on the **left**, the rows of the tasks: the same rows as the tree view (the
  twisty collapses and expands the children of a task, the ctrl+click works the
  same way);
* on the **right**, the chart.

The chart has **one column per day**. The days are grouped by **week** and the
weeks by **month**, with three rows of headers:

```
+-----------+--------------------------------------------------+
| Task      | 11 November       | 12 December               |
|           | 48 Nov 22 | 49 Nov 29 | 50 Dec 6 | 51 Dec 13      |
|           | 22 23 24 25 | 26 27 28 29 30 | 1 2 3 4 5 | 6 7 8 9 10   |
+-----------+--------------------------------------------------+
| Plan the  | [=================]                              |
| release   |                                                 |
+-----------+--------------------------------------------------+
```

The weeks start on **Sunday** and end on Saturday.

### The numbering

The numbering does **not** depend on the part of the schedule that is shown:

* the **months** keep the number of the month of the year: a task that starts
  in December shows `12 December`, whatever the schedule covers;
* the **weeks** are counted from the first day of the year: the week that holds
  the first of January is the **week 1**, even when it starts in December of
  the year before. The last week of a year is the week that holds its 31st of
  December: it is shared with the first week of the next year when the 31st of
  December is not a Saturday.

### The months follow the days

A month ends exactly where the next one begins, even when a week crosses the
boundary of two months: the header of the months is cut on the days, not on the
weeks.

The months can therefore **not** be collapsed any more (a month is not always
a whole number of columns). Clicking a month is a shortcut that collapses (or
expands) **every week that holds at least one day of that month**.

### The colours of the days

The day columns alternate between a **white** and a **very light grey**
background, so the days are easy to count. The weekends keep a slightly
darker grey.

### The bars

A bar is drawn for every task, from the day of its `start=` date to the day of
its `end=` date. The bar carries the colour of the status of the task and the
name of the task. A task without an end date goes until the end of the
schedule, a task without a start date begins with it.

### Dragging the bars

The dates of a task are changed by dragging its bar:

| What the user grabs | What happens |
| ------------------- | ------------ |
| The **middle** of the bar | The task moves: the start and the end are shifted by the same number of days. |
| The **left handle** of the bar | Only the start date changes. |
| The **right handle** of the bar | Only the end date changes. |

The bar follows the pointer while it is dragged and the new dates are written
in the file when the user releases the button.

A task always lasts **at least one day**: the end date cannot be dragged to
the day of the start (or before) and the start date cannot be dragged to the
day of the end (or after). The bar cannot leave the schedule either.

### Collapsing

A **week** can be collapsed by clicking its header: its days are not drawn any
more and the whole period becomes a single narrow column. Clicking it again
expands it. The **months** cannot be collapsed (they follow the days), but
clicking a month collapses or expands every week that holds a day of it.

### Where the data comes from

The whole chart costs **two** round trips and reads no file at all:

```
GET  (find)      every task file below the project folder  -> the ids
POST /api/shell  grep -rH -e '^id=' -e '^parent=' -e '^status=' -e '^title=' -e '^tags=' -e '^start=' -e '^end=' .
```

The range of the schedule goes from the earliest date of the tasks to the
latest one, widened to whole weeks.

---

## 5 ter. The comments of a task

**Files:** `src/core/comment.ts`, `src/core/projectStore.ts`, `src/ui/taskDialog.ts`

A task can have **0 or more comments**. Every comment is a text file of its
own, stored in the project folder, named `comment_<id>.txt`. The format is the
format of the task files: a block of `key=value` lines, a line that contains
only the separator and then the text of the comment.

```
id=3
task=12
created=20261021024529365
updated=20261021024529365
----
The text of the comment.
```

The `task` key holds the id of the task the comment belongs to. The ids of the
comments are **incremental integers**, unique in the project, exactly like the
ids of the tasks: the next comment takes the number of the highest one plus
one.

### In the editor of the task

The editor of a task shows the comments of the task, **the most recent first**
(the creation date is the order, the id breaks the ties). Every comment can be
edited or deleted, and a new one can be written at the bottom of the list.

The comments of a task are found with a `grep` on the `task=` key, so only the
comment files of that task are read.

---

## 5 quater. The notes

**Files:** `src/core/note.ts`, `src/core/markdown.ts`, `src/core/projectStore.ts`, `src/ui/noteDialog.ts`, `src/ui/noteTable.ts`, `src/ui/markdownView.ts`

The notes are a **new kind of thing**, next to the tasks and the comments: a
simple replacement for a note taking application. They do not involve the tasks
at all: a note never has a parent, a status or a tag.

### The file of a note

A note is a text file of its own, stored in the project folder, named
`note_<id>.txt`. Its format is the format of the task files: a block of
`key=value` lines, a line that contains only the separator and then the body of
the note.

```
id=12
title=Shopping list
created=20261022100000000
updated=20261022100000000
----
# Shopping

- milk
- eggs
```

The ids of the notes are **incremental integers**, unique in the project,
exactly like the ids of the tasks and the ids of the comments.

### The markdown of the body

The body of a note is **markdown**. The parser (`src/core/markdown.ts`) is pure
and covered by unit tests: it understands the headings, the paragraphs, the
bulleted and the numbered lists, the quotes, the code blocks, the horizontal
rules, the **bold**, the *italic*, the ~~strikethrough~~, the `code`, the
[links](https://example.org), the images and the `\` escape character.

The renderer (`src/ui/markdownView.ts`) builds the DOM **node by node**: the text
of a note is never injected as HTML, so a note can hold any text. The links and
the images are checked: only the `http`, `https` and `mailto` schemes and the
relative URLs are kept, a `javascript:` URL never reaches the page.

The editor of a note shows the body either as **plain text** (the markdown
source, in a text area) or **rendered**, and the user switches from one to the
other with the two buttons of the editor.

### The search

The search field of the toolbar looks for the notes when the **Notes** mode is
displayed, and the drop down next to it chooses what is searched:

| Scope | What is looked at |
|---|---|
| `both` | the title and the body of the note |
| `title` | the title of the note only |
| `content` | the body of the note only |

The comparison ignores the case and looks for the term as a piece of text.

In the **service** mode, the titles are read with **one** command (the
`title=` keys of every note, no file is downloaded) and the bodies are found
with a `grep`; the files that hold the term are then read to make sure the term
is really in the body. In the **embedded** mode, the same search is done in
JavaScript, over the files of the storage of the browser.

### The listing and the pagination

The notes are listed **ten per page**, like the tasks. The pagination bar of the
notes mode has the four usual buttons (first, previous, next and last), an
**input that jumps to a page number** when the user presses `Enter`, and an
**input that changes the amount of notes per page** (from 10 to 100).

The amount of notes per page is kept in the configuration of the project, next
to the amount of tasks per page: `notePageSize` in
`~/.config/GnumarusProjectManager/config.json`.

---

## 6. The project of the user

**Files:** `src/core/projectStore.ts`, `src/core/serviceStore.ts`, `src/core/embeddedStore.ts`, `src/core/browserStorage.ts`, `src/core/zip.ts`, `src/ui/projectDialog.ts`

The files of the project can live in two places:

* **the Gnumarus OS Bridge service**: the files are on the disk of the machine;
* an **embedded project**: the files are kept in the browser.

The dialog of the project (the button **Project…** of the top bar) chooses
between them, and offers the export and the import of a ZIP archive.

### The facade

The shell of the service (`find`, `grep`) is not available in the browser, so
the application never talks to the storage directly: it goes through the
`ProjectStore` interface, which has two implementations.

| | `ServiceProjectStore` | `EmbeddedProjectStore` |
|---|---|---|
| The files | on the disk, through the service | in the browser |
| The listing | `find` | the paths of the storage |
| The search | `grep` | the content of the files, in JavaScript |
| The hierarchy | `grep` on the `parent=` keys | the metadata of the files, in JavaScript |

The paths are always **relative** to the project folder, so the two
implementations agree on the names of the files.

### The storage of the browser

The **Origin Private File System** is used when the browser offers it: it is a
real file system, the paths of the project are kept as they are and the export
to a ZIP archive is a straight copy.

When the OPFS is not available (an old browser, a page that is not in a secure
context), the files fall back to an **IndexedDB** database, which stores the
same paths and the same contents.

When the browser offers neither, the files are kept in the **memory of the
page**: the project is then lost when the page is closed, and the application
warns the user that the ZIP archive is the only way to keep it.

Only **one** embedded project can live in a browser.

### The ZIP archives

The archive holds the files of the project, **exactly as they would be on the
disk**: `task_1.txt` for a task, `comment_1.txt` for a comment.

The archives are written and read by the application itself (the "stored"
method of the ZIP format, without compression), so that no dependency is needed.
The export downloads the archive, the import reads it and **replaces the whole
embedded project**: the files of the current one are discarded completely.

---

## 7. The bridge service

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

## 8. Configuration file

**Files:** `src/core/config.ts`

The selected project folder and the page size are stored in
`~/.config/GnumarusProjectManager/config.json`, written through the bridge
service, so the choice survives a browser cache wipe and can be shared by
different browsers. The browser only stores the token, which changes every time
the service restarts, and only when the service demands one.

The **kind of storage** of the project (the service or the embedded project) is
a choice of the browser, not of the machine: it is kept in the local storage,
under the key `gnumarus-project-manager.mode`. The configuration of an embedded
project (only the page size) is kept under
`gnumarus-project-manager.config`.

---

## 9. The folder picker

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

## 10. Layout and responsiveness

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

## 11. Tests

| Suite | What it covers |
| ----- | -------------- |
| `src/core/task.test.ts` | Format, parsing, serialization, round trip, tags, moving a task under another parent. |
| `src/core/pagination.test.ts` | Page count, clamping, slicing, page information. |
| `src/core/taskTree.test.ts` | The tree of the tasks: roots, children, orphan tasks, cycles, focus, expansion, search and subtree of a task. |
| `src/core/config.test.ts` | Configuration parsing and serialization. |
| `src/api/client.test.ts` | Tagged values, headers, error handling, shell calls, authentication policy of the service (mocked `fetch`). |
| `src/core/serviceStore.test.ts` | The store of the service against the **running bridge**: creation, listing, pagination, recursive search, update, deletion, creation of a child task, counting and listing of the children, reading of the hierarchy. Skipped when the service is unreachable, or when it demands a token that is not in `GNUMARUS_API_TOKEN`. |
| `src/core/zip.test.ts` | The ZIP archives: the checksum, the round trip, the empty archive, the damaged file and the unicode characters. |
| `src/core/embeddedStore.test.ts` | The embedded project: the creation of a task, the metadata, the search, the children, the comments, the export and the import. |
| `src/core/browserStorage.test.ts` | The storage of the browser: the storages the browser offers, and the files it keeps. |
| `src/core/note.test.ts` | The note file format: the names, the parsing, the serialization, the round trip, the search scopes and the summary of the body. |
| `src/core/markdown.test.ts` | The markdown parser: the headings, the paragraphs, the lists, the quotes, the code blocks, the rules and the inline marks. |
| `src/ui/widgets.test.ts` | The task table (parent column, children badge, action buttons) and the pagination bar (jsdom). |
| `src/ui/app.test.ts` | The whole application against an in memory fake of the service (jsdom), including the creation of a child task, the navigation between the parent and its children, the optional token, the tree view and the board. |
| `src/ui/kanbanBoard.test.ts` | The board: the columns and their order, the cards, their tags and their actions. |
| `src/ui/kanbanDrag.test.ts` | The drag and drop of the cards of the board between the columns. |
| `src/core/gantt.test.ts` | The schedule of the Gantt chart: the days, the weeks, the months, the columns and the bars. |
| `src/ui/ganttDrag.test.ts` | The drag of the bars of the Gantt chart: moving a task, changing one of its dates and the limits. |
| `src/ui/treeDrag.test.ts` | The drag and drop of the rows of the tree: the drop target, the thresholds, the buttons that never start a drag, the click that ends the drag and the detachment of a task. |
| `src/ui/fileDialog.test.ts` | Path helpers, sorting of the file list, the picker itself: the list is not rebuilt when an item is selected and `Enter` enters the selected folder. |
| `src/ui/markdownView.test.ts` | The rendering of the markdown: the blocks, the inline marks, the safe URLs and the fact that the text of a note is never injected as markup. |
| `scripts/e2e-smoke.sh` | The built application is rendered by a headless Chrome at the domain root and at a nested path. |
| `scripts/e2e-browser.mjs` | A real browser drives the application: pagination, search, creation, edition, deletion and the tree view, checked against the files on disk. It also drives the **notes** (the listing, the pagination, the jump to a page, the search scopes, the preview and the creation) and the **embedded project**: the switch, the creation of a task, the export of the ZIP archive and its import. |

Commands:

```bash
npm test            # the unit and integration test suites
npm run e2e         # the headless render test
npm run e2e:browser # the browser end to end test
npm run verify      # everything, in order
```

---

## 12. Deployment

**File:** `scripts/deploy.mjs`

`npm run deploy` builds the application and copies `dist` to
`/var/www/html/GnumarusProjectManager`, replacing the previous copy. The
application is built with `base: './'`, so the relative asset URLs work at the
domain root (`http://localhost/`) and at any nested path
(`http://localhost/my/web/app/path`).
