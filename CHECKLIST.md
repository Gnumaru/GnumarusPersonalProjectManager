# Checklist

## Batch 28 - Dimmed planning/done/canceled rows in tree and Gantt

### Change

- [x] Rows with status `planning`, `done` or `canceled` look dimmed in the
      tree and Gantt views, like hidden tasks (`src/core/task.ts`,
      `src/ui/taskTreeView.ts`, `src/ui/ganttView.ts`, `src/styles.css`)

### Tests

- [x] `src/core/task.test.ts` - `isDimmedStatus`
- [x] `src/ui/app.test.ts` - tree rows dimmed by status
- [x] `src/ui/ganttView.test.ts` - chart rows dimmed by status

### Build / deploy

- [x] `npm run typecheck`, `npm test` (456 tests), `npm run build`
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`
- [x] Compared consistency of all documentation files

## Batch 27 - Edited tasks refresh in the tree view

### Fix

- [x] Saving a task drops it from the tree task cache, so the next refresh
      re-reads the file (`src/ui/app.ts`)
- [x] The editor reopened afterwards shows the new values

### Tests

- [x] `src/ui/app.test.ts` - editing a title updates the row and the editor

### Build / deploy

- [x] `npm run typecheck`, `npm test` (453 tests), `npm run build`
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`
- [x] Compared consistency of all documentation files

## Batch 26 - Hidden tasks in the tree and Gantt views

### Data layer

- [x] `tree_gantt_hidden` boolean metadata key in `src/core/task.ts`
- [x] `TaskSummary.treeGanttHidden`, stores and fake bridge
- [x] `tree_gantt_show_hidden` key in `src/core/appConfig.ts`

### User interface

- [x] Hide checkbox on every tree row and Gantt row
- [x] Global show-hidden checkbox in the tree and Gantt headers
- [x] Hidden subtrees are skipped, shown dimmed while the toggle is on

### Tests

- [x] `src/core/task.test.ts`, `src/core/taskTree.test.ts` - flag and row filter
- [x] `src/ui/app.test.ts`, `src/ui/ganttView.test.ts` - hiding persists,
      toggle filters, reload restores

### Build / deploy

- [x] `npm run typecheck`, `npm test` (452 tests), `npm run build`
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`
- [x] Compared consistency of all documentation files

## Batch 25 - Focused task persisted in config.txt

### Data layer

- [x] `focus_tree=` and `focus_gantt=` keys in `src/core/appConfig.ts`

### User interface

- [x] Focusing a task writes the file back
- [x] Reloading restores the focus of each view

### Tests

- [x] `src/core/appConfig.test.ts` - focus round trips
- [x] `src/ui/app.test.ts` - focusing persists, reopening restores

### Build / deploy

- [x] `npm run typecheck`, `npm test` (443 tests), `npm run build`
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`
- [x] Compared consistency of all documentation files

## Batch 24 - Last view persisted in config.txt

### Data layer

- [x] `view=` key in `src/core/appConfig.ts` (parsed, validated, serialized)

### User interface

- [x] The app opens in the view saved in `config.txt`
- [x] Switching views writes the file back

### Tests

- [x] `src/core/appConfig.test.ts` - view round trips
- [x] `src/ui/app.test.ts` - switching persists, reopening restores

### Build / deploy

- [x] `npm run typecheck`, `npm test` (439 tests), `npm run build`
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`
- [x] Compared consistency of all documentation files

## Batch 23 - Kanban toggles persisted in config.txt

### Data layer

- [x] `src/core/appConfig.ts` - parse and serialize the `config.txt` metadata
- [x] `readAppConfig` / `writeAppConfig` on the project stores

### User interface

- [x] The Kanban column and global show-hidden toggles load from `config.txt`
- [x] Toggling a checkbox writes the file back

### Tests

- [x] `src/core/appConfig.test.ts` - format round trips
- [x] `src/ui/app.test.ts` - toggles persist and reload from the file

### Build / deploy

- [x] `npm run typecheck`, `npm test` (435 tests), `npm run build`
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`
- [x] Compared consistency of all documentation files

## Batch 22 - Hidden tasks on the Kanban board

### Data layer

- [x] `kanban_hidden` boolean metadata key in `src/core/task.ts` (parsed,
      serialized only when hidden, `updated` untouched)
- [x] `TaskSummary.kanbanHidden` and `TaskCard.kanbanHidden`
- [x] The four stores read and pass the flag, plus the fake bridge

### User interface

- [x] Checkbox on every Kanban card to hide the task
- [x] Checkbox on every column to show its hidden cards (unchecked by default)
- [x] Global checkbox to show the hidden cards of every column
- [x] Hidden cards shown dimmed while the toggle is on

### Tests

- [x] `src/core/task.test.ts` - parse and serialize `kanban_hidden`
- [x] `src/ui/kanbanBoard.test.ts` - hide checkbox, column and global toggles
- [x] `src/ui/app.test.ts` - hiding persists to the file, toggles filter cards

### Build / deploy

- [x] `npm run typecheck`, `npm test` (425 tests), `npm run build`
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`
- [x] Compared consistency of all documentation files

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

## Batch 21 - Task ordering in the Kanban, tree and Gantt views

### Data layer

- [x] `kanban_order` and `tree_gantt_order` metadata keys in `src/core/task.ts`
      (parsed, serialized, defaulted to 0)
- [x] `TaskSummary.kanbanOrder` and `TaskSummary.treeGanttOrder` in
      `src/core/projectStore.ts`
- [x] The four stores read and pass the two orders
- [x] `buildTaskTree` sorts roots and children by `tree_gantt_order`, then id

### User interface

- [x] The Kanban, tree and Gantt views show the tasks in the saved order
- [x] Up and down buttons on every tree row, Gantt row and Kanban card
- [x] The tree and the Gantt share one order (`tree_gantt_order`)
- [x] The Kanban keeps its own order (`kanban_order`)
- [x] Dragging a Kanban card to another column recomputes the order of both
      columns
- [x] Normalization on load: per parent (tree/Gantt) and per status (Kanban),
      the orders become `0, 1, 2, ...` and the changed values are written back

### Tests

- [x] `src/core/task.test.ts` - serialization and round trip of the two orders
- [x] `src/ui/ganttView.test.ts` - the up/down actions
- [x] `src/ui/kanbanBoard.test.ts` - the up/down actions
- [x] `scripts/e2e-browser.mjs` - the two new actions do not break the
      checks (122/122)

### Build / deploy

- [x] `npm run verify` (417 tests, 122/122 browser checks)
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`
- [x] Compared consistency of all documentation files

## Batch 20 - Gantt schedule margin and column rendering

### Gantt chart

- [x] The schedule always shows at least one full week before the week with
      the smallest displayed `start` and one full week after the week with
      the largest displayed `end` (`buildPaddedSchedule` in `src/core/gantt.ts`,
      used by `src/ui/app.ts`)
- [x] The schedule range is computed from the displayed rows, not from every
      task in the project
- [x] The week with the `end` date in the next month is drawn
- [x] The margin week before the smallest `start` draws the horizontal row
      separators across the whole chart width: `.gantt-chart-row` stays in
      the single column of the chart panel (`src/styles.css`)
- [x] Clicking a month collapses/expands every week holding at least one day
      of that month, even when the week starts in another month

### Tests

- [x] `src/core/gantt.test.ts` - margin weeks, month-spanning weeks
- [x] `src/ui/app.test.ts` - schedule from displayed rows with margins,
      month-spanning collapse, end date in the next month
- [x] `src/ui/ganttView.test.ts` - chart rows carry no inline grid placement
- [x] `scripts/e2e-browser.mjs` - margin weeks visible across a month
      boundary, with row separators spanning the chart, in a real browser

### Build / deploy

- [x] `npm run verify` (417 tests, 122/122 browser checks)
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`
- [x] Compared consistency of all documentation files

## Batch 19 - Gantt names, row actions and focus

### Gantt chart

- [x] The column of the task names is **480px** wide, 50% wider than the
      previous 320px (`src/styles.css`)
- [x] The names are aligned to the **left** and **wrap** over several lines
- [x] The names and the chart are two **subgrids** of shared row tracks: a
      wrapped name makes its chart row taller, so the bars stay aligned with
      their names
- [x] The names stay **pinned on the left** when the chart scrolls horizontally
      (the grid is as wide as its columns, so the sticky cells can follow the
      scroll)
- [x] The indentation is **9px per level**, half of the 18px of the tree view
      (`GANTT_INDENT_PX` in `src/ui/ganttView.ts`)
- [x] Every row offers the **focus**, **edit** and **add child** actions, in
      that order
- [x] The **focus breadcrumb** of the tree view is shown above the chart, with
      the **General root** item that resets the focus
- [x] Adding a child from a chart row loads the task by id before opening the
      creation dialog
- [x] A ctrl+click still collapses or expands the whole branch

### Tests

- [x] `src/ui/ganttView.test.ts` - the 9px indentation, the row actions and
      their handlers, and the shared row tracks of the names and the chart
- [x] `src/ui/app.test.ts` - the Gantt indentation, the focus and its reset,
      and the creation of a child from the chart
- [x] `scripts/e2e-browser.mjs` - the 480px column, the left alignment, the
      wrapping, the shared row heights, the sticky names, the 9px indentation,
      the child creation and the focus breadcrumb, in a real browser

### Build / deploy

- [x] `npm run verify` (410 tests, 120/120 browser checks)
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`
- [x] Compared consistency of all documentation files

## Batch 19 - Comment count badge on the tasks

### Every view that lists the tasks

- [x] A small circle with the number of comments of the task is shown to the
      left of its name, in the flat list, in the tree, on the board and on the
      Gantt chart
- [x] A task without comments shows no badge

### Data

- [x] `commentCounts()` on the store, one `grep` command for the service, in
      memory for the embedded and file system stores
- [x] The count is read once per refresh and kept in the state of the app

### Tests

- [x] `npm run verify` (417 tests, 121/121 browser checks)
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`

## Batch 18 - Sortable columns in the list and in the notes

### Task list

- [x] A click on the name of a sortable column sorts the table by it: ID, Title,
      Parent, Status, Updated (tags and actions are never sortable)
- [x] A new sort column sorts **descending** first; clicking the same column
      again **inverts** the direction
- [x] The comparison follows the column: numeric for the ids and the parents,
      alphabetical (numbers inside the text compared as numbers) for the titles
      and the statuses, and by date for the `updated=` timestamps
- [x] The sort is global, across the pages: one metadata command reads every
      task, only the page is read in full, and the sort goes back to page 1

### Notes list

- [x] The same sorting rule on the ID, Title and Updated columns
- [x] The note summaries (id, title, updated) are read with one `grep` command
      when the sort is active

### Tests

- [x] `src/core/tableSort.test.ts` - the state machine of the sort and the three
      kinds of comparison, with the ties kept in place
- [x] `src/ui/app.test.ts` - the header clicks on both tables, the parents
      without value sorting first, the page going back to 1, and the notes view
- [x] `scripts/e2e-browser.mjs` - the descending click, the inversion, the
      non-sortable tags and the notes sorted by title

### Build / deploy

- [x] `npm run verify` (404 tests, 110/110 browser checks)
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`

## Batch 17 - The search on the board and the chart

### Gantt chart

- [x] The search shows the tasks that match and their whole chain of ancestors,
      with the branches of the ancestors opened (same behaviour as the tree)
- [x] Clearing the search brings back the default of the tree

### Kanban board

- [x] Only the leaf tasks (without a child) that match stay on the board
- [x] The other cards disappear and come back when the search is emptied

### Tests

- [x] `src/ui/app.test.ts` - the ancestors on the chart, the single leaf on the
      board and the cards coming back
- [x] `scripts/e2e-browser.mjs` - the board search and the chart search,
      including the clearing

### Build / deploy

- [x] `npm run verify` (390 tests, 105/105 browser checks)
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`

## Batch 16 - Card colours and default dates on load

### Kanban board

- [x] A card is painted with the colour of the column it sits in, one shade
      darker than the column (background and border), in both themes
- [x] The colour follows the card: dragging it onto another column repaints it

### Default dates on load

- [x] `withDefaultDates(task, now)` in `src/core/task.ts`: an empty `start=`
      receives the day of today and an empty `end=` the day of tomorrow, at
      midnight, without touching `updated=`
- [x] `src/ui/app.ts` seeds the dates of every task it loads (list, tree,
      board and Gantt) and writes the change into the files, only once per task
- [x] The Gantt of the current refresh shows the assigned dates right away

### Tests

- [x] `src/core/task.test.ts` - defaults, kept dates, `updated` untouched
- [x] `src/ui/app.test.ts` - the files receive the dates on the load; the Gantt
      tests and the fixtures were adapted (the helper `setDates` replaces the
      whole line now)
- [x] `scripts/e2e-browser.mjs` - the card is darker than its column, the
      columns hold different card colours, and the card changes colour when it
      is dragged onto another column

### Build / deploy

- [x] `npm run verify` (388 tests, 101/101 browser checks)
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`

## Batch 15 - Task expansion metadata and ripgrep searches

### Task format

- [x] `src/core/task.ts` - `expanded` on `Task`, parsed and serialized
      (`expanded=true` written only when expanded; removed when collapsed)
- [x] `withExpandedState(task, expanded)`: does not touch `updated=`

### Stores

- [x] `TaskSummary.expanded` in `src/core/projectStore.ts`
- [x] `src/core/embeddedStore.ts` and `src/core/fileSystemStore.ts` pass it
- [x] `src/core/serviceStore.ts` reads `expanded=` with the metadata command

### Ripgrep

- [x] `rg` probe and `rg` search commands in `src/core/serviceStore.ts`
- [x] `grep` fallback when `rg` is unavailable

### App

- [x] `src/ui/app.ts` seeds the tree state from the summaries and persists every
      expansion change (toggle, subtree, focus, parent of a new child, drop)

### Tests

- [x] `src/core/task.test.ts` format tests
- [x] `src/test-support/fakeBridge.ts` emulates the new commands
- [x] `src/ui/app.test.ts` persistence of the expansion
- [x] live `src/core/serviceStore.test.ts` metadata includes `expanded`
- [x] `scripts/e2e-browser.mjs` reload restores the state

### Build / deploy

- [x] `npm run verify` (385 tests, 98/98 browser checks)
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
- [x] Compared consistency of all documentation files.
