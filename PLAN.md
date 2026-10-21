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
  |-- src/core/pagination.ts   pure pagination math
  |-- src/core/config.ts       ~/.config/GnumarusProjectManager/config.json
  |-- src/ui/*                 DOM widgets (top bar, task table, dialogs, file picker)
```

### Task file format

```
id=12
title=Implement pagination
status=todo
tags=frontend ui
created=2026-10-20T22:00:00.000Z
updated=2026-10-20T22:00:00.000Z
----
Free text description of the task.
```

* Metadata is a block of `key=value` lines (like an `.ini` file).
* The metadata block ends with a line containing exactly `----`.
* Everything after that line is the description (free text, may contain anything).
* Root tasks have **no** `parent` key. Child tasks would carry `parent=<id>`.
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

### Pagination and memory

Only the tasks of the current page are loaded into memory. The repository first
resolves the *paths* of the matching task files, slices the requested page out of
them and only then reads those 10 files. Switching pages discards the previous page.

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
