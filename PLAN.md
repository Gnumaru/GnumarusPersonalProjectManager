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
  |-- src/core/taskRepository.ts  data access (find, grep, read, create, update, delete)
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
----
Free text description of the task.
```

* Metadata is a block of `key=value` lines (like an `.ini` file).
* The metadata block ends with a line containing exactly `----`.
* Everything after that line is the description (free text, may contain anything).
* Root tasks have **no** `parent` key. Child tasks would carry `parent=<id>`.
* `status` is one of `planning`, `next`, `todo`, `doing`, `paused`, `done` or
  `canceled` (the badge shows the name in upper case).
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

Only the tasks of the current page are loaded into memory. The repository first
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

## Steps

1. [x] Scaffold the project (package.json, tsconfig, vite config, index.html).
2. [x] Implement and unit test the task file format (parse/serialize).
3. [x] Implement and unit test the API client and the repository (find/grep/read/write).
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

## Verification commands

```bash
npm run typecheck      # tsc --noEmit, strictest flags
npm test               # vitest: unit + integration (live bridge when the token is exported)
npm run build          # type check + production build
npm run e2e            # headless Chrome renders the app at the root and at a nested path
npm run e2e:browser    # a real browser drives pagination, search, create, edit and delete
npm run verify         # all of the above, in order
npm run deploy         # build and publish to /var/www/html/GnumarusProjectManager
```

The integration suite reads the token from `GNUMARUS_API_TOKEN` and skips itself
when the variable is missing, so the tests never fail because the service is
not running.

## Out of scope for this batch

* Grand children in the user interface (the format supports them).
* Multi project management, task ordering by hand, due dates, attachments.
