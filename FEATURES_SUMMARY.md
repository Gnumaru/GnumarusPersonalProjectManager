# Features Summary

Gnumarus Project Manager - **root tasks and child tasks**, displayed as a flat
list or as a tree.

## Task management

| Feature | Status | Where |
| ------- | ------ | ----- |
| List the tasks of the selected folder | Done | `src/ui/taskTable.ts` |
| Paginated listing, 10 tasks per page | Done | `src/core/pagination.ts`, `src/ui/paginationBar.ts` |
| First / previous / next / last page buttons | Done | `src/ui/paginationBar.ts` |
| Create a root task | Done | `src/ui/taskDialog.ts`, `src/core/projectStore.ts` |
| **Create a child task from an existing parent task** | Done | `src/ui/taskTable.ts`, `src/ui/taskDialog.ts` |
| **List the children of a task and open them** | Done | `src/ui/taskDialog.ts` |
| **Show the parent of a task and the amount of children of a task** | Done | `src/ui/taskTable.ts` |
| Edit a task | Done | `src/ui/taskDialog.ts`, `src/core/projectStore.ts` |
| View a task | Done | `src/ui/taskDialog.ts` |
| Delete a task (with confirmation) | Done | `src/ui/taskDialog.ts`, `src/core/projectStore.ts` |
| Recursive search of the tasks (grep) | Done | `src/core/serviceStore.ts`, `src/core/embeddedStore.ts` |
| **Sortable columns: click a name to sort descending, click again to invert** | Done | `src/core/tableSort.ts`, `src/ui/app.ts` |
| **Global sort across the pages, numeric / alphabetical / date per column** | Done | `src/core/tableSort.ts`, `src/ui/app.ts` |
| **Comment count badge to the left of the task name, in every view** | Done | `src/ui/taskTable.ts`, `src/ui/taskTreeView.ts`, `src/ui/kanbanBoard.ts`, `src/ui/ganttView.ts` |
| Free form tags (add and remove) | Done | `src/core/task.ts` |
| Task status (planning, next, to do, doing, paused, done, canceled) | Done | `src/core/task.ts` |

## Tree view

| Feature | Status | Where |
| ------- | ------ | ----- |
| **List / Tree / Kanban / Gantt toggle** | Done | `src/ui/app.ts` |
| **One row per task, with its name and its tags** | Done | `src/ui/taskTreeView.ts` |
| **Collapse and expand the children of a task** | Done | `src/ui/taskTreeView.ts`, `src/core/taskTree.ts` |
| **The expanded state is stored in the task file and restored on open** | Done | `src/core/task.ts`, `src/ui/app.ts` |
| **Ctrl+click collapses or expands the whole branch** | Done | `src/ui/app.ts`, `src/core/taskTree.ts` |
| **Drag and drop: a task dropped on another one becomes its child** | Done | `src/ui/treeDrag.ts`, `src/ui/app.ts` |
| **The branch of the parent opens when a child task is added to it** | Done | `src/ui/app.ts` |
| **Drag and drop: a task dropped on the general root becomes a root task** | Done | `src/ui/treeDrag.ts`, `src/ui/app.ts` |
| **Focus the tree on a task (it becomes the root of the tree)** | Done | `src/ui/app.ts` |
| **Focus the general root (every task without a parent)** | Done | `src/ui/app.ts` |
| **Breadcrumb of the focused task** | Done | `src/ui/app.ts` |
| **View and edit dialogs opened from a row of the tree** | Done | `src/ui/taskTreeView.ts` |
| **The hierarchy read with a single `grep`** | Done | `src/core/serviceStore.ts`, `src/core/embeddedStore.ts` |
| **Only the displayed task files are read** | Done | `src/ui/app.ts` |

## Storage

| Feature | Status | Where |
| ------- | ------ | ----- |
| One text file per task (`task_<id>.txt`) | Done | `src/core/task.ts` |
| `key=value` metadata block ended by `----` | Done | `src/core/task.ts` |
| Description as free text after the separator | Done | `src/core/task.ts` |
| Unique incremental task id | Done | `src/core/projectStore.ts` |
| Automatic id allocation, collision safe | Done | `src/core/projectStore.ts` |
| `parent=<id>` key written and read for the child tasks | Done | `src/core/task.ts` |
| **`blocked_by=...`: the tasks that block a task** | Done | `src/core/task.ts` |
| **`related=...`: the tasks that are related to a task** | Done | `src/core/task.ts` |
| **The blocking and the related tasks are edited in the editor** | Done | `src/ui/idListField.ts` |
| **The comments of a task, one file `comment_<id>.txt` each** | Done | `src/core/comment.ts` |
| **The comments are listed, created, edited and deleted in the editor** | Done | `src/ui/taskDialog.ts` |
| **A task moved under another one (drag and drop)** | Done | `src/core/task.ts`, `src/core/projectStore.ts` |
| **Dates written in the compact format `YYYYMMDDHHNNSSIII` (local time, no timezone)** | Done | `src/core/task.ts` |
| **`start=...` and `end=...`: the start and the end date of a task** | Done | `src/core/task.ts` |
| **A new task is created with the start date of today and the end date of tomorrow** | Done | `src/ui/taskDialog.ts` |
| **A task loaded without dates receives today (start) and tomorrow (end)** | Done | `src/core/task.ts`, `src/ui/app.ts` |
| **Date pickers for the start and the end date in the editor** | Done | `src/ui/taskDialog.ts` |
| Amount of children per task (read with `grep`) | Done | `src/core/serviceStore.ts`, `src/core/embeddedStore.ts` |

## Bridge integration

| Feature | Status | Where |
| ------- | ------ | ----- |
| REST client with the API token | Done | `src/api/client.ts` |
| Token entered by the user, kept in `localStorage` | Done | `src/ui/app.ts` |
| **Detection of a service started without the token requirement** | Done | `src/api/client.ts` |
| **No token asked when the service does not require one** | Done | `src/ui/app.ts` |
| **Token button hidden when the token is useless** | Done | `src/ui/app.ts` |
| Service availability banner and periodic ping | Done | `src/ui/app.ts` |
| Configuration file in `~/.config/GnumarusProjectManager/config.json` | Done | `src/core/config.ts` |

## Board of the tasks

| Feature | Status | Where |
| ------- | ------ | ----- |
| **Kanban board: one column per status** | Done | `src/ui/kanbanBoard.ts` |
| **Board columns colored from top to bottom with the colour of their status** | Done | `src/styles.css` |
| **Cards colored with the colour of their column, a shade darker, changing when dragged** | Done | `src/styles.css` |
| **Search on the board: only the matching leaves stay on the board** | Done | `src/ui/app.ts` |
| **The titles of the cards are shown in full (the text wraps, cards of unequal height)** | Done | `src/styles.css` |
| **Columns in the order PLANNING, TODO, NEXT, PAUSED, DOING, DONE, CANCELED** | Done | `src/core/task.ts` |
| **Only the tasks that have no child are on the board** | Done | `src/core/projectStore.ts` |
| **Drag and drop between the columns changes the status** | Done | `src/ui/kanbanDrag.ts` |
| **A card opens the task and its editor** | Done | `src/ui/kanbanBoard.ts` |
| **Hide a card with a checkbox (`kanban_hidden`), show hidden per column or globally** | Done | `src/ui/kanbanBoard.ts`, `src/ui/app.ts` |
| **Kanban show-hidden toggles persisted in `config.txt`** | Done | `src/core/appConfig.ts`, `src/ui/app.ts` |
| **Last view persisted in `config.txt`** | Done | `src/core/appConfig.ts`, `src/ui/app.ts` |
| **Focused task of each view persisted in `config.txt`** | Done | `src/core/appConfig.ts`, `src/ui/app.ts` |
| **Hide tasks in the tree and Gantt (`tree_gantt_hidden`), one global show toggle** | Done | `src/ui/taskTreeView.ts`, `src/ui/ganttView.ts`, `src/ui/app.ts` |

## Gantt chart

| Feature | Status | Where |
| ------- | ------ | ----- |
| **Gantt chart: the tasks on the left, the chart on the right** | Done | `src/ui/ganttView.ts` |
| **The column of the names is 480px wide, 50% wider than before** | Done | `src/styles.css` |
| **The names are aligned to the left and wrap over several lines** | Done | `src/styles.css` |
| **The chart follows the height of the wrapped names** | Done | `src/ui/ganttView.ts`, `src/styles.css` |
| **The names stay pinned on the left when the chart scrolls** | Done | `src/styles.css` |
| **The indentation is 9px per level, half of the tree view** | Done | `src/ui/ganttView.ts` |
| **Every row offers focus, edit and add-child actions** | Done | `src/ui/ganttView.ts` |
| **The focus breadcrumb of the tree, with the General root reset** | Done | `src/ui/app.ts` |
| **Up and down reordering in the tree and in the Gantt chart** | Done | `src/ui/taskTreeView.ts`, `src/ui/ganttView.ts` |
| **Up and down reordering in the Kanban columns** | Done | `src/ui/kanbanBoard.ts` |
| **Shared order for the tree and the Gantt, independent for the Kanban** | Done | `src/core/task.ts` |
| **Normalization of the orders on load** | Done | `src/ui/app.ts` |
| **Search on the chart: the matches and their chain of ancestors** | Done | `src/core/taskTree.ts`, `src/ui/app.ts` |
| **One column per day** | Done | `src/core/gantt.ts` |
| **The days grouped by week and the weeks by month** | Done | `src/core/gantt.ts` |
| **The weeks and the months numbered and named, counting from one** | Done | `src/core/gantt.ts` |
| **The months numbered with the number of the month of the year** | Done | `src/core/gantt.ts` |
| **The weeks numbered from the first day of the year** | Done | `src/core/gantt.ts` |
| **The months follow the days and cannot be collapsed any more** | Done | `src/core/gantt.ts` |
| **Clicking a month collapses every week that holds a day of it** | Done | `src/ui/app.ts` |
| **The day columns alternate between two colours** | Done | `src/ui/ganttView.ts` |
| **The weeks and the months can be collapsed and expanded** | Done | `src/ui/ganttView.ts` |
| **A bar from the start date to the end date of the task** | Done | `src/core/gantt.ts` |
| **The bars can be dragged to change the dates of a task** | Done | `src/ui/ganttDrag.ts` |
| **The bars carry the colour of the status** | Done | `src/styles.css` |
| **One margin week before the smallest start and after the largest end** | Done | `src/ui/app.ts`, `src/core/gantt.ts` |
| **The chart rows span the whole chart, with their separators** | Done | `src/styles.css` |

## The notes

| Feature | Status | Where |
| ------- | ------ | ----- |
| **Notes: a new display mode, next to the tasks** | Done | `src/ui/app.ts` |
| **Every note is a file `note_<id>.txt`, with its id inside the file** | Done | `src/core/note.ts` |
| **The body of a note is markdown** | Done | `src/core/markdown.ts` |
| **The note is edited as plain text and shown as rendered markdown** | Done | `src/ui/noteDialog.ts` |
| **The search of the notes: the title, the content or both** | Done | `src/ui/app.ts` |
| **The notes are paginated, ten per page** | Done | `src/ui/paginationBar.ts` |
| **An input jumps to the page the user types** | Done | `src/ui/paginationBar.ts` |
| **The amount of notes per page is configurable, from 10 to 100** | Done | `src/core/config.ts` |
| **The notes work in the service mode and in the embedded mode** | Done | `src/core/projectStore.ts` |
| **Sortable notes: ID, Title and Updated, same first-descending rule** | Done | `src/core/tableSort.ts`, `src/ui/app.ts` |

## The project

| Feature | Status | Where |
| ------- | ------ | ----- |
| **The files live in the service, in an embedded project or in a folder of the disk** | Done | `src/ui/projectDialog.ts` |
| **The File System Access API: the files live in a folder chosen by the user** | Done | `src/core/fileSystemStore.ts` |
| **The choices the browser does not offer are disabled** | Done | `src/ui/projectDialog.ts` |
| **The default is the File System Access API, then the OPFS, then the service** | Done | `src/core/config.ts` |
| **The application works without the low level service in that mode** | Done | `src/ui/app.ts` |
| **The embedded project is kept in the OPFS, or in an IndexedDB** | Done | `src/core/browserStorage.ts` |
| **The embedded project needs no folder: the OPFS is the root of the project** | Done | `src/core/browserStorage.ts` |
| **The tasks and the notes are created right away in the embedded project** | Done | `src/ui/app.ts` |
| **The project can be downloaded as a ZIP archive** | Done | `src/core/zip.ts` |
| **A ZIP archive can be imported as the embedded project** | Done | `src/ui/app.ts` |
| **One storage facade for the service and for the browser** | Done | `src/core/projectStore.ts` |
| **Only one embedded project in the browser: an import replaces it completely** | Done | `src/core/embeddedStore.ts` |
| **Every file of the project carries its id inside the file** | Done | `src/core/task.ts`, `src/core/comment.ts`, `src/core/note.ts` |

## User interface

| Feature | Status | Where |
| ------- | ------ | ----- |
| OS like folder picker (back, forward, up, root, drives, home, path box, new folder) | Done | `src/ui/fileDialog.ts` |
| **Enter enters the selected folder in the picker** | Done | `src/ui/fileDialog.ts` |
| **The scroll of the picker is kept when an item is clicked** | Done | `src/ui/fileDialog.ts` |
| Responsive, desktop first layout (1366x768 and above) | Done | `src/styles.css` |
| Light and dark colour schemes | Done | `src/styles.css` |
| Keyboard shortcuts (`Ctrl+F` focuses the search, `Enter` searches, `Esc` clears) | Done | `src/ui/app.ts` |
| Toasts for the feedback of every action | Done | `src/ui/toast.ts` |
| Works at the domain root and at any nested path | Done | `vite.config.ts` (`base: './'`) |

## Quality

| Feature | Status | Where |
| ------- | ------ | ----- |
| Strict TypeScript (`strict` plus the strictest extra flags, no `any`) | Done | `tsconfig.json` |
| The types of the File System Access API are declared in the project, without any dependency | Done | `src/types/fileSystemAccess.d.ts` |
| Unit tests of the format, the pagination, the tree, the client and the widgets | Done | `src/**/*.test.ts` |
| **Task and note searches through the service use ripgrep when it is available** | Done | `src/core/serviceStore.ts` |
| Unit tests of the embedded project, of the storage of the browser and of the ZIP archives | Done | `src/core/embeddedStore.test.ts`, `src/core/browserStorage.test.ts`, `src/core/zip.test.ts` |
| Integration tests against the running bridge (with or without a token) | Done | `src/core/serviceStore.test.ts` |
| Browser end to end test driving a real Chrome | Done | `scripts/e2e-browser.mjs` |
| Headless render test at the root and at a nested path | Done | `scripts/e2e-smoke.sh` |
| Automated deploy to `/var/www/html/GnumarusProjectManager` | Done | `scripts/deploy.mjs` |

## Not implemented yet (planned for the next batches)

* Multi project management.
* Priorities.
