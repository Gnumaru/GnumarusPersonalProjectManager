# Gnumarus Project Manager - Development Plan

## Goal

Frontend only web application for project management, where every task is a
plain text file on the local disk, accessed exclusively through the
`GnumarusOSBridge` low-level REST API (`http://127.0.0.1:1423`).

## Current Status

- Batch 31 moves the Kanban global show-hidden toolbar above the
  columns: `.kanban-wrap` becomes a vertical stack so the toolbar no longer
  sits to the left of the last column.
- Verification: 459 unit tests pass.
- All planned batches (1-30) are implemented.
- Batch 30 moves the search shortcut to Ctrl+Shift+F so plain Ctrl+F stays
  with the browser find-in-page.
- Batch 29 halves the Gantt indent to 4.5px per level and uses the same
  indent in the tree view.
- Batch 28 dims tree and Gantt rows with status `planning`, `done` or
  `canceled`, like hidden tasks.
- Batch 27 fixes stale tree rows after editing: saving a task invalidates its
  cached copy so the refresh re-reads the file.
- Batch 26 hides tasks in the tree and Gantt views with a `tree_gantt_hidden`
  flag and a single global show-hidden toggle.
- Batch 25 keeps the focused task of each view in `config.txt`, so reloading
  returns the focus exactly as before.
- Batch 24 keeps the current view in `config.txt`, so the app reopens in the
  same view.
- Batch 23 persists the Kanban show-hidden toggles in a `config.txt` file in
  the project folder, written as `key=value` metadata with no description section.
- Verification: 459 unit tests pass.
- Batch 22 adds hidden tasks on the Kanban board: `kanban_hidden` metadata, a
  hide checkbox on every card, a show-hidden checkbox per column and a global one.
- Batch 21 adds task ordering: `kanban_order` and `tree_gantt_order` metadata,
  up/down reordering in the Kanban, tree and Gantt views, a shared order for
  tree/Gantt, an independent order for Kanban, column-aware reordering when a
  Kanban card changes status, and normalization on load.
- Batch 20 fixed the Gantt columns: the schedule always keeps one full margin
  week before the smallest displayed start and one after the largest displayed
  end (computed from the displayed rows), the week of an end date in the next
  month is drawn, every chart row spans the whole chart so the separators cross
  the margin weeks, and clicking a month covers weeks starting in another month.
- Batch 19 reworked the Gantt view: the name column is 480px wide, the names
  are left aligned and wrap, the rows share their height with the chart through
  subgrids, the names stay pinned on the left, the indentation is 9px per
  level, every row has focus/edit/add-child actions and the chart keeps the
  focus breadcrumb of the tree view.
- Verification: 425 unit tests pass.
- Documentation consistency verified.

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
  |-- src/core/tableSort.ts    sorting state machine of the tables (pure)
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
