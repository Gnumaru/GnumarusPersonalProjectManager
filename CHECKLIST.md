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
- [x] `src/core/pagination.ts` - page count, clamping, slicing
- [x] `src/core/config.ts` - `~/.config/GnumarusProjectManager/config.json`

### Bridge access
- [x] `src/api/client.ts` - token aware REST client, tagged scalar decoding
- [x] `src/core/taskRepository.ts` - find / grep / read / create / update / delete

### UI
- [x] Top bar: project directory, service status, token, refresh
- [x] Toolbar: search box, clear search, new task
- [x] Task table: id, title, tags, status, updated, actions
- [x] Pagination bar: first / previous / next / last + "page X of Y"
- [x] Task dialog: view mode and edit mode (title, status, tags, description)
- [x] Delete confirmation
- [x] OS-like directory picker (back, forward, up, root, drives, home, path box, new folder)
- [x] Service unavailable banner with periodic ping
- [x] Toasts for feedback
- [x] Responsive CSS, desktop first (1366x768 minimum)

### Tests
- [x] `src/core/task.test.ts` - format round trips
- [x] `src/core/pagination.test.ts` - pagination math
- [x] `src/core/config.test.ts` - config load/save
- [x] `src/api/client.test.ts` - client against a mocked `fetch`
- [x] `src/core/taskRepository.test.ts` - integration against the live bridge
- [x] `src/ui/widgets.test.ts` - task table and pagination bar (jsdom)
- [x] `src/ui/app.test.ts` - the whole application against a fake bridge (jsdom)
- [x] `src/ui/fileDialog.test.ts` - path helpers and file list sorting
- [x] `scripts/e2e-smoke.sh` - headless Chrome renders the built app (root and nested path)
- [x] `scripts/e2e-browser.mjs` - real browser drives pagination, search, create, edit and delete

### Build / deploy
- [x] `npm run typecheck`
- [x] `npm test`
- [x] `npm run build`
- [x] `npm run e2e`
- [x] `npm run e2e:browser`
- [x] `npm run deploy` -> `/var/www/html/GnumarusProjectManager`
