# Gnumarus Project Manager - Development Plan

## Goal

Frontend only web application for project management, where every task is a
plain text file on the local disk, accessed exclusively through the
`GnumarusOSBridge` low-level REST API (`http://127.0.0.1:1423`).

Batch 1 delivered the **root tasks** (tasks that have no parent): create, edit,
view, delete, search and a paginated listing (10 tasks per page).

Batch 2 adds the **child tasks**: a task can be created from an existing parent
task, the relations are visible in the listing and in the task view.

## Architecture

```
Browser (SPA, no framework, strict TypeScript)
  |
  |-- src/api/client.ts        REST client for the GnumarusOSBridge API (token aware)
  |-- src/core/task.ts         task file format: parse / serialize
  |-- src/core/note.ts         note file format: parse / serialize
  |-- src/core/markdown.ts     markdown parser (pure)
  |-- src/core/projectStore.ts the storage facade: the interface the application uses
  |-- src/core/serviceStore.ts the implementation over the service (find, grep, read, write)
  |-- src/core/embeddedStore.ts the implementation over the storage of the browser
  |-- src/core/browserStorage.ts the OPFS, with an IndexedDB fallback
  |-- src/core/fileSystemAccess.ts the File System Access API of the browser
  |-- src/core/fileSystemStore.ts the implementation over a folder of the disk
  |-- src/core/zip.ts          the reader and the writer of the ZIP archives
  |-- src/core/taskTree.ts     tree of the tasks: build / flatten (pure)
  |-- src/core/pagination.ts   pure pagination math
  |-- src/core/config.ts       ~/.config/GnumarusProjectManager/config.json
  |-- src/ui/*                 DOM widgets (top bar, task table, task tree, dialogs, file picker)
```

### Task file format

```
id=12
title=Implement pagination
status=todo
tags=frontend ui
created=20261020220000000
updated=20261020220000000
start=
end=
blocked_by=3,5
related=7,9
----
Free text description of the task.
```

* Metadata is a block of `key=value` lines (like an `.ini` file).
* The metadata block ends with a line containing exactly `----`.
* Everything after that line is the description (free text, may contain anything).
* Root tasks have **no** `parent` key. Child tasks would carry `parent=<id>`.
* `status` is one of `planning`, `next`, `todo`, `doing`, `paused`, `done` or
  `canceled` (the badge shows the name in upper case).
* `blocked_by` holds the ids of the tasks that **block** this one: they
  prevent its completion.
* `related` holds the ids of the tasks that are **related** to this one: a
  relation the user makes explicit, that is neither a blocking relation nor a
  parent/child relation.
* The dates are written in the compact format `YYYYMMDDHHNNSSIII` (local time,
  no timezone). A task also carries the dates of its start and of its end.
* `tags` is a whitespace separated list (a tag can never contain whitespace).
* File name is `task_<id>.txt`, `<id>` being a unique incremental integer.

### Talking to the bridge

| Purpose | Endpoint |
| ------- | -------- |
| availability probe | `GET /api/help` (open route, no token) |
| read a task file | `GET /api/file?path=` |
| create a task file | `POST /api/file?path=` |
| update a task file | `PUT /api/file?path=` |
| delete a task file | `DELETE /api/file?path=` |
| list a directory | `GET /api/dir?path=` |
| recursive listing | `POST /api/shell` -> `find . -type f -name 'task_*.txt'` |
| recursive search | `POST /api/shell` -> `grep -rIl --fixed-strings --ignore-case --include='task_*.txt' -f - .` (pattern through stdin, never through the command line) |
| amount of children | `POST /api/shell` -> `grep -rh ... '^parent=' . \| cut -d= -f2 \| sort \| uniq -c` |
| children of one task | `POST /api/shell` -> `grep -rl ... -e '^parent=<id>$' .` |

The API token is entered by the user in the app and kept in `localStorage`
(ephemeral, same lifetime as the token of the running service). The last selected
project directory is persisted in `~/.config/GnumarusProjectManager/config.json`
through the bridge, so it survives browser cache clearing.

The token is **optional**: when the service announces (or proves) that it does
not require one, the application never shows the token dialog and never sends
an `Authorization` header it does not have.

### Pagination and memory

Only the tasks of the current page are loaded into memory. The store first
resolves the *paths* of the matching task files, slices the requested page out of
them and only then reads those 10 files. Switching pages discards the previous page.

## Batch 3 - Optional API token

The Gnumarus OS Bridge service can be started with the flag that **disables the
token requirement**. When that happens the application must work exactly as
before, but it must **not ask the user for a token**.

The authentication policy is discovered in this order:

1. `GET /api/help` publishes an `auth` block whose `required` field is a tagged
   boolean (`b:true` / `b:false`). `b:false` means "no token needed".
2. When the help page does not publish the policy, a **protected route is
   probed without any token** (`GET /api/sysinfo`, then `POST /api/shell` with a
   harmless `echo`). A `401` answer means "a token is required", a `2xx` answer
   means "no token needed".
3. When nothing can be determined, the application behaves conservatively and
   asks for the token.

The policy is read again on every service check (every five seconds), so a
service restarted with the opposite policy is noticed without a reload.

## Batch 4 - Tree view

The flat list stays as it is. A **second view mode** shows the tasks as a tree:
every task is a row with its name (and its tags), the rows can be collapsed and
expanded, and the tree can be **focused** on a task (that task becomes the root
of the displayed tree, the tasks outside of its hierarchy are hidden) or on the
**general root** (every task without a parent is shown).

### Where the data comes from

The structure is read with **one** `grep` that only looks at the `parent=`
lines of the task files, combined with the listing of the task files (the ids
come from the file names). The content of the files never reaches the browser
except for the rows that are actually displayed.

```
GET  (find)      every task file below the project folder  -> the ids
POST /api/shell  grep -rH '^parent='                      -> the parent of every task
```

Only the tasks of the **visible rows** are read (their file is read to get the
title and the tags), so the memory holds the tree that is on the screen and
nothing else.

### Collapsing and expanding

* A **simple click** on the twisty of a task only changes that task: the state
  of its children is kept (a collapsed child stays collapsed, an expanded child
  stays expanded).
* A **ctrl+click** on the twisty collapses or expands the **whole branch**: the
  task and every one of its descendants, at any depth.

### Drag and drop

A task can be **dragged onto another task** to become its child: the `parent=`
key of its file is rewritten and the task leaves its previous parent.

A task can also be **detached from its parent** to become a root task again. It
is enough to drop it:

* on the **general root** (the first item of the breadcrumb, above the list);
* on the **empty space** below the last row of the list.

The drag is driven by the mouse (not by the native HTML5 drag and drop) so the
application controls the feedback: the dragged row is dimmed, the row under the
pointer is highlighted and a chip with the name of the task follows the pointer.
A simple click is not a drag: the pointer has to travel a few pixels first, so
the name of the task still opens the task and the twisty still expands it.

A task can never become a child of one of its own descendants: that would
build a cycle, and the application refuses the move with a message.

### The pure part

`src/core/taskTree.ts` builds the tree from the `id -> parent` mapping and
flattens it into the rows to display:

* a task whose parent does not exist is a **root** (it would otherwise be
  invisible),
* a cycle in the `parent=` keys is broken (the task that closes the cycle
  becomes a root),
* the traversal keeps the ids of the current path, so a cycle can never loop
  forever.

## Batch 5 - Board of the tasks

The third display mode is a **board** (Kanban): one column per status, the
cards of the tasks that have **no child** (a task with children is represented
by its children on the board).

The columns are always in the same order:

```
PLANNING | TODO | NEXT | PAUSED | DOING | DONE | CANCELED
```

A card can be **dragged from one column to another one** to change the status
of the task: the `status=` key of its file is rewritten.

The data is read with **one** command that returns the parent, the status, the
title and the tags of every task, so the whole board costs two round trips
(the listing of the files and that command) and no file is read.

## Batch 7 - Gantt chart

The fourth display mode is a **Gantt chart**. The window is split in two: the
rows of the tasks on the left, the chart on the right.

The chart has **one column per day**; the days are grouped by **week** (from
Sunday to Saturday) and the weeks by **month**. The **months** are numbered
with the number of the month of the year (a task that starts in December shows
`12`) and the **weeks** are numbered from the first day of the year (the week
that holds the first of January is the week 1, even when it starts in December
of the year before).

A **bar** is drawn for every task, from the day of its `start=` date to the day
of its `end=` date. A week (or a month) can be **collapsed**: its days are not
drawn any more and the whole period becomes a single column.

The rows of the left panel are the visible rows of the tree (the twisty
collapses and expands the children of a task, the ctrl+click works the same).

The data comes from **one** command that reads the parent, the status, the
title and the dates of every task, so the chart costs two round trips and
reads no file.

## Batch 9 - The embedded project

The files of the project can live in the **browser** instead of the disk of the
machine: the application then works on an *embedded project* and never calls
the low level service.

Since the shell of the service is not available in the browser, everything is
computed in JavaScript. The application therefore goes through a **facade**,
`ProjectStore`, with two implementations:

| Implementation | Where the files live | How the queries are made |
| -------------- | -------------------- | ----------------------- |
| `ServiceProjectStore` | the disk, through the service | `find` and `grep` |
| `EmbeddedProjectStore` | the browser | in JavaScript, over the files |

The storage of the browser is the **Origin Private File System** when the browser
offers it, and an **IndexedDB** database otherwise. Only **one** embedded project
can live in a browser.

The embedded project can be **downloaded as a ZIP archive** (the files are
exactly the ones that would be on the disk) and a ZIP archive can be **imported**,
which replaces the whole embedded project.

The ZIP archives are written and read by the application itself (the "stored"
method, without compression), so no dependency is needed.

## Steps

1. [x] Scaffold the project (package.json, tsconfig, vite config, index.html).
2. [x] Implement and unit test the task file format (parse/serialize).
3. [x] Implement and unit test the API client and the store of the service (find/grep/read/write).
4. [x] Implement the paginated task listing UI (10 per page, first/prev/next/last).
5. [x] Implement create / edit / view / delete of root tasks.
6. [x] Implement the recursive search (grep through the bridge).
7. [x] Implement the OS-like directory picker.
8. [x] Implement token handling, service availability banner and periodic ping.
9. [x] Write the tests (unit, integration against the live bridge, headless Chrome smoke test).
10. [x] Build, run every test and deploy to `/var/www/html/GnumarusProjectManager`.
11. [x] Child tasks: create a task from an existing parent, show the parent of a
    task, count and list the children of a task.
12. [x] Optional token: detect that the service does not require a token
    (`/api/help` `auth.required`, or a probe of a protected route) and never
    ask the user for a token in that case.
13. [x] Tree view: a second display mode with collapsible rows, the focus on a
    task and the focus on the general root.
14. [x] Folder picker: `Enter` enters the selected folder and the scroll of the
    list is not reset when an item is selected.
15. [x] Drag and drop in the tree view: a task dropped on another one becomes
    its child.
16. [x] Task statuses: `PLANNING`, `NEXT`, `TODO`, `DOING`, `PAUSED`, `DONE`
    and `CANCELED`.
17. [x] Board of the tasks: one column per status, the tasks that have no
    child, and the drag and drop that changes the status.
18. [x] The dates are stored in the compact format `YYYYMMDDHHNNSSIII` (local
    time, no timezone) and the tasks carry a start and an end date.
19. [x] Gantt chart: the rows of the tasks on the left, the chart on the right,
    one column per day, the weeks and the months numbered and named, and the
    bars drawn from the start date to the end date.
20. [x] Date pickers in the editor: the user chooses the start date and the end
    date of a task.
21. [x] The bars of the Gantt chart can be dragged: the middle of a bar moves
    the task, its handles change the start or the end date.
22. [x] The Gantt chart: the months follow the days (and cannot be collapsed any
    more), the weeks are numbered from the year and the day columns alternate
    between two colours.
23. [x] The tasks that block a task and the tasks that are related to it are
    written in the file and edited in the editor.
24. [x] The comments of a task: a file `comment_<id>.txt` per comment, listed in
    the editor of the task.
25. [x] The embedded project: the files live in the browser, the project can be
    downloaded as a ZIP archive and imported from a ZIP archive.
26. [x] The notes: a new display mode, the notes are files `note_<id>.txt` whose
    body is markdown, they are searched by title or by content and they are
    paginated.
27. [x] The File System Access API: a third kind of storage, the files live in
    a folder of the disk chosen by the user, without the low level service.
28. [x] The embedded project works without a folder: the OPFS is the root of
    the project and the tasks and the notes are created right away.

## Batch 10 - The notes

The notes are a **new kind of thing**, next to the tasks and the comments: a
simple replacement for a note taking application. They do not involve the tasks
at all: a note never has a parent, a status or a tag.

A note is a text file of its own, named `note_<id>.txt`, stored in the project
folder. Its format is the format of the task files: a block of `key=value`
lines, a line that contains only the separator and then the body of the note:

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

The body of the note is **markdown**. The editor shows it either as plain text
(the markdown source) or rendered, and the renderer is written in the project
(no dependency): the DOM is built node by node, never with `innerHTML`.

The **Notes** button of the toolbar opens the new display mode. In that mode:

* the search field looks for the notes, and a drop down chooses what is
  searched: the **title**, the **content** or **both**;
* the listing shows the notes of the current page, ten per page by default;
* the pagination bar has the four usual buttons, an input that jumps to a page
  number when the user presses `Enter`, and an input that changes the amount of
  notes per page (from 10 to 100);
* the amount of notes per page is kept in the configuration of the project.

The notes live in the same files as the tasks, so they work the same way in the
service mode and in the embedded mode: the facade of the storage gained the
note operations and both implementations offer them.

### The ids inside the files

Every file of the project carries its own id **inside** the file, not only in
its name:

| Kind of file | Name | Key inside the file |
| ------------ | ---- | ------------------- |
| Task | `task_<id>.txt` | `id=<id>` |
| Comment | `comment_<id>.txt` | `id=<id>` |
| Note | `note_<id>.txt` | `id=<id>` |

The id inside the file is the one the application uses: the name of the file is
only a fallback for the files written before the key existed.

## Batch 11 - The File System Access API

The files of the project can also live in a folder of the disk, reached
**directly** by the browser with the **File System Access API** (the Chromium
based browsers only). The application then works **without the low level
service of Gnumarus**.

The dialog of the project offers three choices:

| Choice | Where the files live |
| ------- | --------------------- |
| The Gnumarus OS Bridge service | the disk, through the service |
| An embedded project, in this browser | the OPFS of the browser |
| File System Access API (Chromium based browsers only) | a folder of the disk, chosen by the user |

The choices the browser does not offer are **disabled**: the OPFS choice needs
the Origin Private File System, the File System Access API choice needs
`window.showDirectoryPicker`.

### The default

When the browser knows nothing about a project that was opened before, the
application chooses:

1. the **File System Access API**, when the browser offers it;
2. the **OPFS**, when the browser offers it;
3. the **Gnumarus OS Bridge service**, everywhere else.

### The folder of the project

The user chooses the folder with the picker of the browser. The handle of the
folder is kept in an **IndexedDB** database, so the project is still there the
next time the page is opened. The *permission* is not kept: the browser asks
the user again, and the application offers a button to give the access back.

The store of this backend (`FileSystemProjectStore`) reads and writes the files
directly. The API offers no `find` and no `grep`: the listing and the search
are done in JavaScript, over the entries of the directory, and only the files
that are needed are read.

## Batch 12 - The embedded project works without a folder

### The problem

When the browser does not offer the File System Access API (Firefox, Safari),
the default kind of storage is the **embedded project**: the files live at the
root of the Origin Private File System. The embedded project has **no folder**
of its own, so the user is never asked for one.

But the guard of the creation of a task asked for a folder
(`config.projectDir === null`), and the folder of the service mode is `null`
in the embedded mode. The button **New task** therefore always answered
"Choose a project folder first.", and there was no way to choose a folder of
the OPFS: the embedded project was unusable.

### The fix

* `hasProject()` is now the single source of truth: the **store** is open.
  The embedded project counts as a project, because it has its own storage.
* The creation of a task and of a note asks for `hasProject()`, not for a
  folder. The message of the error depends on the kind of storage.
* The empty state of the embedded project offers **New task** (and not
  "Choose folder…"), and it does not speak of a folder.
* The path of the project shows the name of the storage of the browser
  (`Embedded project (OPFS)`), so the user sees where the files are.
* The shortcut `/` focuses the search in every kind of storage.
* The folder of the service is kept in the memory when the user goes to the
  embedded project, and it is read again from the configuration file of the
  machine when the user comes back.

### The Origin Private File System is the root of the project

The paths of the project are the paths of the files, relative to the root of
the OPFS: `task_1.txt` and `note_1.txt` live at its root. The detection of
the API takes the window of the page as a parameter (`supportsOpfs(win)`), like
the one of the File System Access API, so the storage of the browser can be
exercised by the test suite.

## Batch 13 - Default dates of a new task

The editor of a task already holds two date pickers (`start` / `end`). When the
dialog is opened to **create** a task, the pickers are now prefilled with the
default range: the **current day** for the start and the **next day** for the
end. The existing files keep their own dates.

## Verification commands

```bash
npm run typecheck      # tsc --noEmit, strictest flags
npm test               # vitest: unit + integration (live bridge when the token is exported)
npm run build          # type check + production build
npm run e2e            # headless Chrome renders the app at the root and at a nested path
npm run e2e:browser    # a real browser drives pagination, search, create, edit, delete
                       # and the embedded project (export and import of the ZIP)
npm run verify         # all of the above, in order
npm run deploy         # build and publish to /var/www/html/GnumarusProjectManager
```

The integration suite reads the token from `GNUMARUS_API_TOKEN` and skips itself
when the variable is missing, so the tests never fail because the service is
not running.

## Out of scope for this batch

* Grand children in the user interface (the format supports them).
* Multi project management, task ordering by hand, due dates, attachments.
* Several embedded projects in the same browser: the browser holds **one**
  embedded project, and importing an archive replaces it completely.
