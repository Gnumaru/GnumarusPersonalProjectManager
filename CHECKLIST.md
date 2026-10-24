# Checklist

## Batch 1 - Root tasks (CRUD + search + pagination)
### Scaffold
- [x] `package.json` with `dev`, `build`, `preview`, `test`, `e2e`, `deploy` scripts
- [x] `tsconfig.json` with `strict` and the strictest extra flags
- [x] `vite.config.ts` with `base: './'` (works at the domain root and at nested paths)
- [x] `index.html` shell
- [x] `.gitignore`

### Core (pure, unit tested)
- [x] `src/core/task.ts` - task file format (parse, serialize, file name helpers)
- [x] `src/core/task.ts` - the seven statuses: `planning`, `next`, `todo`,
      `doing`, `paused`, `done`, `canceled`
- [x] `src/core/task.ts` - the `blocked_by` and the `related` keys
- [x] `src/core/task.ts` - the compact timestamps `YYYYMMDDHHNNSSIII` (local
      time, no timezone), the old ISO format is still read
- [x] `src/core/task.ts` - the `start` and `end` dates of a task
- [x] `src/core/pagination.ts` - page count, clamping, slicing
- [x] `src/core/config.ts` - `~/.config/GnumarusProjectManager/config.json`

### Bridge access
- [x] `src/api/client.ts` - token aware REST client, tagged scalar decoding
- [x] `src/core/serviceStore.ts` - find / grep / read / create / update / delete

### UI
- [x] Top bar: project directory, service status, token, refresh
- [x] Toolbar: search box, clear search, new task
- [x] Task table: id, title, tags, status, updated, actions
- [x] Pagination bar: first / previous / next / last + "page X of Y"
- [x] Task dialog: view mode and edit mode (title, status, tags, description)
- [x] Delete confirmation
- [x] OS-like directory picker (back, forward, up, root, drives, home, path box, new folder)
- [x] `Enter` enters the selected folder in the picker
- [x] The scroll of the picker is not reset when an item is clicked
- [x] Service unavailable banner with periodic ping
- [x] Toasts for feedback
- [x] Responsive CSS, desktop first (1366x768 minimum)

### Tests
- [x] `src/core/task.test.ts` - format round trips
- [x] `src/core/pagination.test.ts` - pagination math
- [x] `src/core/config.test.ts` - config load/save
- [x] `src/api/client.test.ts` - client against a mocked `fetch`
- [x] `src/core/serviceStore.test.ts` - integration against the live bridge
- [x] `src/ui/widgets.test.ts` - task table and pagination bar (jsdom)
- [x] `src/ui/widgets.test.ts` - the badge of every status
- [x] `src/ui/app.test.ts` - the whole application against a fake bridge (jsdom)
- [x] `src/ui/fileDialog.test.ts` - path helpers and file list sorting
- [x] `src/ui/fileDialog.test.ts` - the picker: the list is not rebuilt when an
      item is selected, `Enter` enters the selected folder
- [x] `scripts/e2e-smoke.sh` - headless Chrome renders the built app (root and nested path)
- [x] `scripts/e2e-browser.mjs` - real browser drives pagination, search, create, edit and delete

### Build / deploy
- [x] `npm run typecheck`
- [x] `npm test`
- [x] `npm run build`
- [x] `npm run e2e`
- [x] `npm run e2e:browser`
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`

## Batch 2 - Child tasks

### Data layer
- [x] `parent=<id>` written in the file of a child task (`src/core/task.ts`)
- [x] `buildTask` accepts a parent id
- [x] `createTask` accepts a parent id and checks that the parent exists
- [x] `childCounts` reads the amount of children of every task with one `grep`
- [x] `findChildren` lists the children of a task

### User interface
- [x] Child button in every row of the table
- [x] "Add child task" button in the view of a task
- [x] The creation dialog announces the parent task
- [x] New "Parent" column: the parent of a task (clickable) or a dash
- [x] Badge with the amount of children next to the title of a task
- [x] Section with the children in the view of a task (clickable)
- [x] Banner with the parent in the view and in the editor of a child task
- [x] Editing a child keeps its parent

### Tests
- [x] `src/core/task.test.ts` - a child task is built and parsed back
- [x] `src/core/serviceStore.test.ts` - creation, counting and listing of the children (live bridge)
- [x] `src/ui/widgets.test.ts` - parent column, children badge and action buttons
- [x] `src/ui/app.test.ts` - creation of a child from the interface and navigation between the parent and its children
- [x] `scripts/e2e-browser.mjs` - creation of a child in a real browser, checked against the file on the disk

### Build / deploy
- [x] `npm run verify`
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`

## Batch 3 - Optional API token

### Detection
- [x] `src/api/client.ts` reads the `auth.required` flag published by `/api/help`
- [x] `parseServiceInfo` decodes the tagged boolean (`b:true` / `b:false`)
- [x] Fallback probe of a protected route without a token (`/api/sysinfo`, then
      `POST /api/shell` with `echo`) when the help page does not publish the policy
- [x] `fetchServiceStatus` reports availability, policy and version in one call

### User interface
- [x] The token dialog is never opened when the service does not require a token
- [x] The **API token** button is hidden when the token is not needed
- [x] The status pill describes the authentication policy in its tooltip
- [x] The configuration is loaded even when there is no token
- [x] A `401` re-reads the policy before the token dialog is shown

### Tests
- [x] `src/api/client.test.ts` - policy announced by the help page, probe fallback,
      unreachable service
- [x] `src/ui/app.test.ts` - no token dialog without a token, token dialog when the
      service demands one
- [x] `src/test-support/fakeBridge.ts` - the fake announces and enforces the policy
- [x] `src/core/serviceStore.test.ts` - the integration suite also runs against a
      service started without the token requirement

### Build / deploy
- [x] `npm run verify`
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`

## Batch 4 - Tree view

### Core (pure, unit tested)
- [x] `src/core/taskTree.ts` - build the tree from the `id -> parent` mapping
- [x] A task whose parent does not exist becomes a root
- [x] A cycle in the `parent=` keys is broken
- [x] `flattenTaskTree` - the rows to display, with the depth and the expansion
- [x] The focus on a task and the focus on the general root
- [x] The ancestors of a task (the breadcrumb)

### Data layer
- [x] `ServiceProjectStore.listTasks` reads the structure with one `grep` of the
      metadata keys (`src/core/serviceStore.ts`)
- [x] `withParent` rewrites the `parent=` key of a task
- [x] `withParent` moves a task under another parent (`src/core/task.ts`)
- [x] Only the files of the displayed rows are read (a few at a time)

### User interface
- [x] A **List / Tree** toggle in the toolbar
- [x] A row per task with its name and its tags
- [x] A twisty to collapse and to expand the children of a task
- [x] A simple click keeps the state of the children of the task
- [x] A ctrl+click collapses or expands the whole branch (the task and all its
      descendants)
- [x] Drag and drop: a task dropped on another one becomes its child
- [x] Drag and drop: a task dropped on the **general root** or on the empty
      space of the list becomes a root task again
- [x] The dragged row is dimmed, the drop target is highlighted and a chip
      follows the pointer
- [x] A task is never moved under one of its own descendants
- [x] An action to focus the tree on a task
- [x] The breadcrumb of the focused task, with the **General root** button
- [x] The view and the edit dialogs are opened from a row of the tree
- [x] The pagination bar is hidden in the tree view
- [x] The search keeps the ancestors of the matches visible

### Tests
- [x] `src/core/taskTree.test.ts` - the tree of the tasks (roots, children, cycles,
      focus, search, subtree of a task)
- [x] `src/ui/treeDrag.test.ts` - the drag and drop of the rows of the tree
- [x] `src/ui/app.test.ts` - the tree in the application (expansion, focus,
      breadcrumb, dialogs, search, recursive expansion with a ctrl+click, drag
      and drop)
- [x] `src/core/serviceStore.test.ts` - the hierarchy read from the live bridge
- [x] `scripts/e2e-browser.mjs` - the tree driven by a real browser

### Build / deploy
- [x] `npm run verify`
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`

## Batch 5 - Board of the tasks

### Data layer
- [x] `ServiceProjectStore.listTasks` reads the cards with one command
      (`id`, `parent`, `status`, `title` and `tags` of every task)
- [x] `withStatus` rewrites the `status=` key of a task
- [x] `BOARD_STATUSES` - the order of the columns of the board
- [x] `withStatus` changes the status of a task (`src/core/task.ts`)

### User interface
- [x] A third view mode: **List / Tree / Kanban**
- [x] One column per status, with the colour of the status and the amount of
      cards
- [x] Only the tasks that have no child are on the board
- [x] A card shows the name and the tags of the task
- [x] The card opens the task and its editor
- [x] Drag and drop between the columns changes the status of the task

### Tests
- [x] `src/ui/kanbanBoard.test.ts` - the columns, the cards and their actions
- [x] `src/ui/kanbanDrag.test.ts` - the drag and drop between the columns
- [x] `src/ui/app.test.ts` - the board in the application and the status change
- [x] `scripts/e2e-browser.mjs` - the board driven by a real browser

### Build / deploy
- [x] `npm run verify`
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`

## Batch 6 - The dates of the tasks

### Core (pure, unit tested)
- [x] `formatTaskTimestamp` writes `YYYYMMDDHHNNSSIII` in local time
- [x] `parseTaskTimestamp` reads it back and still accepts the old ISO format
- [x] `normalizeTaskTimestamp` turns an unknown value into an empty string
- [x] `created` and `updated` are written in the compact format
- [x] `start` and `end` are written, read and kept when the task is edited

### User interface
- [x] The view of a task shows the **Created**, **Updated**, **Start** and
      **End** dates, formatted for the user
- [x] The editor holds a **date picker** for the start date and for the end date
- [x] The end date cannot be before the start date
- [x] The editor holds a field for the **blocking** and for the **related**
      tasks: the ids become chips that can be removed
- [x] A task cannot block itself nor be related to itself
- [x] The view of a task shows the blocking and the related tasks

### Tests
- [x] `src/core/task.test.ts` - the compact format, the migration of the old
      format, the start and the end dates, the conversion for the date pickers,
      the blocking and the related tasks
- [x] `src/core/serviceStore.test.ts` - the file written by the live bridge
- [x] `src/ui/widgets.test.ts`, `src/ui/app.test.ts` - the fixtures, the date
      pickers of the editor, the blocking and the related tasks

### Build / deploy
- [x] `npm run verify`
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`

## Batch 7 - Gantt chart

### Core (pure, unit tested)
- [x] `src/core/gantt.ts` - the days, the weeks and the months of a schedule
- [x] The weeks start on **Sunday** and end on Saturday
- [x] The weeks and the months are numbered and named, counting from one
- [x] The months keep the number of the month of the year (December is 12)
- [x] The weeks are counted from the first day of the year: the week that holds
      the first of January is the week 1
- [x] The months follow the days: a month ends where the next one begins
- [x] The months cannot be collapsed any more, only the weeks
- [x] Clicking a month collapses or expands every week that holds a day of it
- [x] The day columns alternate between a white and a very light grey
- [x] `buildLayout` - the columns of the chart and the headers
- [x] A collapsed week or month becomes a single column
- [x] `barOf` and `barGeometry` - the bar of a task, from its start date to its
      end date

### Data layer
- [x] `ServiceProjectStore.listTasks` reads the parent, the status, the title
      and the dates of every task with one command
- [x] The board and the Gantt chart share that command

### User interface
- [x] A fourth view mode: **List / Tree / Kanban / Gantt**
- [x] The rows of the tasks on the left, the chart on the right
- [x] One column per day, the days grouped by week and the weeks by month
- [x] The bars are drawn from the start date to the end date of the task
- [x] The middle of a bar can be dragged: the task moves
- [x] The handles of a bar can be dragged: the start or the end date changes
- [x] A task always lasts at least one day
- [x] The bars carry the colour of the status
- [x] The weeks and the months are collapsed and expanded by clicking them
- [x] The rows of the left panel collapse and expand the children of a task
- [x] A ctrl+click collapses or expands the whole branch of a task

### Tests
- [x] `src/core/gantt.test.ts` - the schedule, the columns and the bars
- [x] `src/ui/ganttDrag.test.ts` - the drag of the bars of the chart
- [x] `src/ui/app.test.ts` - the chart in the application, the collapse and the
      drag of a bar
- [x] `scripts/e2e-browser.mjs` - the chart driven by a real browser

### Build / deploy
- [x] `npm run verify`
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`

## Batch 8 - The comments of the tasks

### Core (pure, unit tested)
- [x] `src/core/comment.ts` - the format of the comment files (`comment_<id>.txt`)
- [x] The ids of the comments are incremental integers, unique in the project
- [x] The comments are sorted by creation, the most recent first

### Data layer
- [x] `ServiceProjectStore.listComments` finds the comments of a task with a `grep`
      on the `task=` key
- [x] `ServiceProjectStore.createComment`, `writeComment` and `deleteComment`

### User interface
- [x] The editor of a task shows the comments, the most recent first
- [x] A comment can be created, edited and deleted

### Tests
- [x] `src/core/comment.test.ts` - the format, the names and the order
- [x] `src/core/serviceStore.test.ts` - the comments against the live bridge
- [x] `src/ui/app.test.ts` - the comments in the editor
- [x] `scripts/e2e-browser.mjs` - a comment written by a real browser

### Build / deploy
- [x] `npm run verify`
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`

## Batch 9 - The embedded project

### The facade
- [x] `src/core/projectStore.ts` - the interface the application uses
- [x] `src/core/serviceStore.ts` - the implementation over the low level service
- [x] `src/core/embeddedStore.ts` - the implementation over the browser storage
- [x] The paths are relative to the project folder in both implementations

### The storage of the browser
- [x] `src/core/browserStorage.ts` - the OPFS, with an IndexedDB fallback
- [x] The memory of the page is the last resort, and the user is warned

### The ZIP archives
- [x] `src/core/zip.ts` - the reader and the writer, without any dependency
- [x] The export downloads the files of the project
- [x] The import replaces the whole embedded project

### User interface
- [x] The dialog of the project chooses where the files are kept
- [x] The folder picker is hidden in the embedded mode

### Tests
- [x] `src/core/zip.test.ts` - the archives
- [x] `src/core/embeddedStore.test.ts` - the embedded project
- [x] `src/core/browserStorage.test.ts` - the storage of the browser
- [x] `src/core/serviceStore.test.ts` - the project of the service
- [x] `scripts/e2e-browser.mjs` - the embedded project driven by a real browser:
      the switch, the creation of a task, the export and the import of the ZIP
      archive

### Build / deploy
- [x] `npm run verify`
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`

## Batch 10 - The notes

### Core (pure, unit tested)
- [x] `src/core/note.ts` - the note file format (`note_<id>.txt`), with the id
      inside the file
- [x] The body of a note is markdown
- [x] `src/core/markdown.ts` - the markdown parser, without any dependency
- [x] The search scopes: the title, the content or both
- [x] `src/core/config.ts` - the amount of notes per page (`notePageSize`),
      from 10 to 100

### Data layer
- [x] `src/core/projectStore.ts` - the note operations of the facade
- [x] `src/core/serviceStore.ts` - the notes on the disk, with `find` and
      `grep`
- [x] `src/core/embeddedStore.ts` - the notes in the browser

### User interface
- [x] The **Notes** display mode, next to the list, the tree, the board and
      the Gantt chart
- [x] The notes are created, edited, viewed and deleted
- [x] The editor shows the note as plain text or as rendered markdown
- [x] The search of the notes, with the drop down of the scope
- [x] The pagination: ten notes per page, the four buttons, the input that
      jumps to a page number and the input of the amount of notes per page

### Tests
- [x] `src/core/note.test.ts` - the note file format
- [x] `src/core/markdown.test.ts` - the markdown parser
- [x] `src/core/serviceStore.test.ts` - the notes against the live bridge
- [x] `src/core/embeddedStore.test.ts` - the notes in the browser
- [x] `src/ui/markdownView.test.ts` - the rendering of the markdown
- [x] `src/ui/app.test.ts` - the notes mode in the application
- [x] `scripts/e2e-browser.mjs` - the notes driven by a real browser

### Build / deploy
- [x] `npm run verify`
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`

## Batch 11 - The File System Access API

### Core
- [x] `src/core/fileSystemAccess.ts` - the picker of the browser, the state of
      the permission and the storage of the handle of the folder
- [x] `src/core/fileSystemStore.ts` - the store over a folder of the disk
- [x] `src/types/fileSystemAccess.d.ts` - the types of the API, without any
      dependency
- [x] `src/core/config.ts` - the kind of storage, with the default of the
      browser: the File System Access API, then the OPFS, then the service

### User interface
- [x] The dialog of the project offers the three choices
- [x] The choices the browser does not offer are disabled
- [x] The application asks for the folder of the project
- [x] The application asks for the permission of the folder again
- [x] The service is not needed by the projects that live in the browser

### Tests
- [x] `src/core/fileSystemStore.test.ts` - the store over a folder of the disk
- [x] `src/core/fileSystemAccess.test.ts` - the picker, the permission and the
      storage of the handle
- [x] `src/core/config.test.ts` - the kind of storage and its default
- [x] `src/ui/app.test.ts` - the File System Access mode in the application
- [x] `scripts/e2e-browser.mjs` - the three choices of the dialog of the
      project

### Build / deploy
- [x] `npm run verify`
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`

## Batch 12 - The embedded project works without a folder

### Core
- [x] `src/ui/app.ts` - `hasProject()` follows the store, not the folder
- [x] `src/ui/app.ts` - the creation of a task and of a note asks for the
      project, not for a folder
- [x] `src/ui/app.ts` - the message of the error depends on the kind of
      storage
- [x] `src/ui/app.ts` - the empty state and the path of the project of the
      embedded project speak of the storage of the browser
- [x] `src/ui/app.ts` - the shortcut `/` works in every kind of storage
- [x] `src/ui/app.ts` - the folder of the service survives a switch to the
      embedded project and back
- [x] `src/core/browserStorage.ts` - the detection of the OPFS takes the
      window of the page

### Tests
- [x] `src/ui/app.test.ts` - the embedded project creates a task and a note
      without a folder, and the file lives at the root of the OPFS
- [x] `src/core/browserStorage.test.ts` - the detection of the OPFS and the
      files of the project at its root
- [x] `src/core/config.test.ts` - the OPFS is the default when the browser
      offers it
- [x] `scripts/e2e-browser.mjs` - the application started on the embedded
      project asks for no folder and creates a task

### Build / deploy
- [x] `npm run verify`
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`

## Batch 14 - Tree expansion and board colors

### Tree view
- [x] Adding a child task (dialog) opens the branch of its parent: a collapsed
      parent is expanded and a parent without a child becomes expanded
- [x] Dropping a task on a parent in the tree opens the branch of the target as
      well

### Kanban board
- [x] Every column is painted from top to bottom with the colour of its status
      (soft background, status-coloured border, header separator and title) and
      the status dot was removed
- [x] The titles of the cards are shown in full: the text wraps over several
      lines, so the cards of a column do not have the same height

### Tests
- [x] `src/ui/app.test.ts` - the branch of a collapsed parent opens when a child
      is added, and the parent that had no child as well
- [x] `src/ui/kanbanBoard.test.ts` - the columns hold no status dot
- [x] `scripts/e2e-browser.mjs` - the branch opened by the drop of a task, no
      status dot on the board, and the tree section adapted to the automatic
      expansion

### Build / deploy
- [x] `npm run verify` (378 tests, 95/95 browser checks)
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`

## Batch 13 - Default dates of a new task

### User interface
- [x] `dateInputValueOfDate` - the picker value of a local `Date`
- [x] The create dialog opens with the start date of **today**
- [x] The create dialog opens with the end date of **tomorrow**
- [x] Editing an existing task keeps its own dates (no default change)

### Tests
- [x] `src/core/task.test.ts` - the picker value of a `Date`
- [x] `src/ui/app.test.ts` - the defaults of the create dialog and the values
      written to the file
- [x] `scripts/e2e-browser.mjs` - the values written for a task created in a
      real browser
- [x] Fix of the board drag of the browser test: the card and the column are
      scrolled into the view before the drag coordinates are computed (the
      failures already happened on the previous version)

### Build / deploy
- [x] `npm run verify` (376 tests, 92/92 browser checks)
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`
