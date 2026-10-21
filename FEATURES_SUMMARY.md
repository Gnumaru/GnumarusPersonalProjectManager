# Features Summary

Gnumarus Project Manager - **root tasks and child tasks**.

## Task management

| Feature | Status | Where |
| ------- | ------ | ----- |
| List the tasks of the selected folder | Done | `src/ui/taskTable.ts` |
| Paginated listing, 10 tasks per page | Done | `src/core/pagination.ts`, `src/ui/paginationBar.ts` |
| First / previous / next / last page buttons | Done | `src/ui/paginationBar.ts` |
| Create a root task | Done | `src/ui/taskDialog.ts`, `src/core/taskRepository.ts` |
| **Create a child task from an existing parent task** | Done | `src/ui/taskTable.ts`, `src/ui/taskDialog.ts` |
| **List the children of a task and open them** | Done | `src/ui/taskDialog.ts` |
| **Show the parent of a task and the amount of children of a task** | Done | `src/ui/taskTable.ts` |
| Edit a task | Done | `src/ui/taskDialog.ts`, `src/core/taskRepository.ts` |
| View a task | Done | `src/ui/taskDialog.ts` |
| Delete a task (with confirmation) | Done | `src/ui/taskDialog.ts`, `src/core/taskRepository.ts` |
| Recursive search of the tasks (grep) | Done | `src/core/taskRepository.ts` |
| Free form tags (add and remove) | Done | `src/core/task.ts` |
| Task status (to do / in progress / done) | Done | `src/core/task.ts` |

## Storage

| Feature | Status | Where |
| ------- | ------ | ----- |
| One text file per task (`task_<id>.txt`) | Done | `src/core/task.ts` |
| `key=value` metadata block ended by `----` | Done | `src/core/task.ts` |
| Description as free text after the separator | Done | `src/core/task.ts` |
| Unique incremental task id | Done | `src/core/taskRepository.ts` |
| Automatic id allocation, collision safe | Done | `src/core/taskRepository.ts` |
| `parent=<id>` key written and read for the child tasks | Done | `src/core/task.ts` |
| Amount of children per task (read with `grep`) | Done | `src/core/taskRepository.ts` |

## Bridge integration

| Feature | Status | Where |
| ------- | ------ | ----- |
| REST client with the API token | Done | `src/api/client.ts` |
| Token entered by the user, kept in `localStorage` | Done | `src/ui/app.ts` |
| Service availability banner and periodic ping | Done | `src/ui/app.ts` |
| Configuration file in `~/.config/GnumarusProjectManager/config.json` | Done | `src/core/config.ts` |

## User interface

| Feature | Status | Where |
| ------- | ------ | ----- |
| OS like folder picker (back, forward, up, root, drives, home, path box, new folder) | Done | `src/ui/fileDialog.ts` |
| Responsive, desktop first layout (1366x768 and above) | Done | `src/styles.css` |
| Light and dark colour schemes | Done | `src/styles.css` |
| Keyboard shortcuts (`Ctrl+F` focuses the search, `Enter` searches, `Esc` clears) | Done | `src/ui/app.ts` |
| Toasts for the feedback of every action | Done | `src/ui/toast.ts` |
| Works at the domain root and at any nested path | Done | `vite.config.ts` (`base: './'`) |

## Quality

| Feature | Status | Where |
| ------- | ------ | ----- |
| Strict TypeScript (`strict` plus the strictest extra flags, no `any`) | Done | `tsconfig.json` |
| Unit tests of the format, the pagination, the client and the widgets | Done | `src/**/*.test.ts` |
| Integration tests against the running bridge | Done | `src/core/taskRepository.test.ts` |
| Browser end to end test driving a real Chrome | Done | `scripts/e2e-browser.mjs` |
| Headless render test at the root and at a nested path | Done | `scripts/e2e-smoke.sh` |
| Automated deploy to `/var/www/html/GnumarusProjectManager` | Done | `scripts/deploy.mjs` |

## Not implemented yet (planned for the next batches)

* Grand children (a task whose parent is itself a child): the format already
  supports it, but the user interface only offers one level of children.
* Multi project management, task dependencies, due dates, priorities.
* Import and export of a project.
