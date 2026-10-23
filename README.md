# Gnumarus Project Manager

A frontend-only web application for project management. Every task, comment and note is a plain text file inside the project folder. The project can live on disk through a low-level REST service, or directly in the browser through the Origin Private File System, or in a folder of the disk through the File System Access API.

## What it is

The application manages tasks that are written as individual `.txt` files (`task_<id>.txt`). Each file starts with a metadata block in `key=value` format, followed by a line containing exactly `----`, followed by the task description. Tasks can have parents, tags, start/end dates, blocking relations, related tasks, and comments. The interface offers list, tree, kanban board, Gantt chart and notes views.

Notes (`note_<id>.txt`) are a new kind of thing: a simple note-taking replacement without parents, statuses or tags. The body of every note is markdown, edited as plain text or shown as rendered markdown.

## Features

- Root tasks with create, edit, view, delete, search and paginated listing (10 per page)
- Child tasks with drag-and-drop parent assignment in the tree view
- Seven statuses: planning, next, todo, doing, paused, done, canceled
- Search by title, tag or description (recursive grep in service mode)
- Paginated listing with first / previous / next / last buttons
- Tree view with collapsible/expandable branches and focus
- Kanban board with drag-and-drop between status columns
- Gantt chart with draggable bars
- Notes mode with markdown editing, preview, paginated listing, page jump input, configurable page size
- Comments on tasks
- Project folder selection through an OS-like file picker
- Embedded project mode (browser storage: OPFS with IndexedDB fallback)
- File System Access API mode (folder of the disk chosen by the user, Chromium browsers only)
- ZIP export/import that produces byte-identical files
- Strict TypeScript, no `any`, all storage operations behind the `ProjectStore` facade

## The file format

### Task

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
Free text description.
```

### Note

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

The `id` key is inside every file and is the one the application uses. The file name is only a fallback for files written before the key existed.

## How to use

The application requires a folder for the project. Choose it with **Choose folder...** or through the **Project...** button.

The **Project...** button opens a dialog that chooses the storage backend:

- **The Gnumarus OS Bridge service** (default when nothing is known): files live on the disk and are reached through the REST API at `http://127.0.0.1:1423`
- **An embedded project, in this browser**: the project lives in the browser (OPFS with IndexedDB fallback); only one embedded project can exist at a time. It needs no folder: the root of the storage is the root of the project
- **File System Access API (Chromium based browsers only)**: files live in a folder chosen by you; the browser asks for access and the application works without the service

In the embedded and File System Access modes, a ZIP archive can be downloaded (the files are byte-identical to the disk format) and imported (replacing the whole project).

The service status pill at the top right shows whether the service is online. When the project lives in the browser, it shows **Service not needed** and the token button is hidden.

## How to build and deploy

```bash
npm install
npm run build
npm run verify        # typecheck, 373 tests, build, smoke E2E, browser E2E (92 checks)
npm run deploy        # builds and copies dist to /var/www/html/GnumarusProjectManager
```

The build command produces `dist/`, which is copied to `/var/www/html/GnumarusProjectManager`. The application works at the domain root (`http://localhost/`) or at a nested path (`http://localhost/my/app/`) because it uses relative asset URLs (`base: './'` in `vite.config.ts`).

## How to use the embedded project

The embedded project is the default in the browsers that do not offer the File System Access API (Firefox, Safari), as long as they offer the Origin Private File System. It needs no folder: the files of the project (`task_<id>.txt`, `note_<id>.txt`) live at the root of the storage of the browser, and the tasks and the notes are created right away.

The top bar shows `Embedded project (OPFS)` when the OPFS holds the files, `Embedded project (IndexedDB)` when the browser offers no OPFS, and the application warns the user when the files can only live in the memory of the page.

## How to use the File System Access API mode

When you choose the File System Access API, the browser asks for the folder with its picker. The handle of the folder is kept in an IndexedDB database, so you do not have to choose again the next time. The permission is not kept: the browser asks again when you open the page, and the application offers a button (**Grant the access**) to restore it.

## Tests

Every feature has tests:

- `src/core/task.test.ts` — the task format
- `src/core/note.test.ts` — the note format
- `src/core/markdown.test.ts` — the markdown parser
- `src/core/pagination.test.ts` — pagination math
- `src/core/taskTree.test.ts` — tree of tasks
- `src/core/zip.test.ts` — ZIP archives
- `src/core/config.test.ts` — configuration
- `src/core/serviceStore.test.ts` — the service store (live bridge, skipped when unreachable)
- `src/core/embeddedStore.test.ts` — the embedded store
- `src/core/browserStorage.test.ts` — the browser storage
- `src/core/fileSystemStore.test.ts` — the File System Access store
- `src/core/fileSystemAccess.test.ts` — the picker, the permission and the handle storage
- `src/ui/app.test.ts` — the whole application with the fake bridge
- `scripts/e2e-browser.mjs` — real headless Chrome, 92 checks (service, embedded, notes, File System Access API)
- `scripts/e2e-smoke.sh` — headless Chrome renders the built app at root and at a nested path

## License

MIT License — Copyright (c) 2026 Gnumaru
