#!/usr/bin/env node
/**
 * Browser end to end test.
 *
 * It drives a real (headless) Chrome through the DevTools protocol, so the
 * whole chain is exercised: the built application, the REST service, the task
 * files on disk and the pagination/search/user interface.
 *
 * Requirements:
 *   - the Gnumarus OS Bridge service running on http://127.0.0.1:1423
 *   - its API token (GNUMARUS_API_TOKEN, or read from the systemd journal), only
 *     when the service was started with the token requirement
 *   - Google Chrome (CHROME_BIN, defaults to /opt/google/chrome/chrome)
 *
 * The script creates its own task folder, points the application configuration
 * to it and restores the previous configuration when it is done.
 */

import { spawn, execFileSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serviceUrl = process.env['GNUMARUS_API_URL'] ?? 'http://127.0.0.1:1423';
const chromeBin = process.env['CHROME_BIN'] ?? '/opt/google/chrome/chrome';
const httpPort = Number.parseInt(process.env['E2E_PORT'] ?? '8933', 10);
const debugPort = Number.parseInt(process.env['E2E_DEBUG_PORT'] ?? '9333', 10);
const workDirectory = resolve(projectRoot, 'tmp/e2e-browser');
const taskDirectory = resolve(workDirectory, 'tasks');
const configPath = '~/.config/GnumarusProjectManager/config.json';

const checks = [];
let failures = 0;

function check(condition, label, details = '') {
  if (condition) {
    checks.push(`ok   ${label}`);
    console.log(`ok   ${label}`);
    return true;
  }
  failures += 1;
  checks.push(`FAIL ${label}${details.length > 0 ? ` - ${details}` : ''}`);
  console.error(`FAIL ${label}${details.length > 0 ? ` - ${details}` : ''}`);
  return false;
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

// --------------------------------------------------------------- service --

function serviceIsUp() {
  try {
    const response = execFileSync('curl', ['-fsS', '--max-time', '3', `${serviceUrl}/api/help`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return response.length > 0;
  } catch {
    return false;
  }
}

/**
 * Reads the authentication policy published by the service.
 *
 * `true` when the service demands a token, `false` when it was started without
 * the token requirement and `null` when it could not be determined.
 */
function serviceAuthRequired() {
  try {
    const response = execFileSync('curl', ['-fsS', '--max-time', '3', `${serviceUrl}/api/help`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const payload = JSON.parse(response);
    const required = payload?.auth?.required;
    if (required === 'b:true') {
      return true;
    }
    if (required === 'b:false') {
      return false;
    }
    return typeof required === 'boolean' ? required : null;
  } catch {
    return null;
  }
}

function resolveToken() {
  const fromEnvironment = process.env['GNUMARUS_API_TOKEN'];
  if (fromEnvironment !== undefined && fromEnvironment.trim().length > 0) {
    return fromEnvironment.trim();
  }
  try {
    const journal = execFileSync(
      'journalctl',
      ['--user', '-u', 'GnumarusOSBridge.service', '--no-pager'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const matches = [...journal.matchAll(/API token:\s*(\S+)/g)];
    const last = matches.at(-1);
    return last === undefined ? null : last[1];
  } catch {
    return null;
  }
}

const token = resolveToken();
const authRequired = serviceAuthRequired();

if (!serviceIsUp()) {
  console.log(`The service ${serviceUrl} is not running: the browser test is skipped.`);
  process.exit(0);
}

if (token === null && authRequired !== false) {
  console.log(
    'The API token could not be found and the service requires one: the browser test is skipped.',
  );
  process.exit(0);
}

const headers = { 'Content-Type': 'application/json' };
if (token !== null) {
  headers.Authorization = `Bearer ${token}`;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${serviceUrl}${path}`, { ...options, headers });
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} failed with ${response.status}`);
  }
  const text = await response.text();
  return text.length === 0 ? {} : JSON.parse(text);
}

async function shell(command) {
  return apiRequest('/api/shell', {
    method: 'POST',
    body: JSON.stringify({ command }),
  });
}

async function writeFileEnsured(path, content) {
  try {
    await apiRequest(`/api/file?path=${encodeURIComponent(path)}`, {
      method: 'POST',
      body: JSON.stringify({ content, encoding: 'text' }),
    });
  } catch {
    await apiRequest(`/api/file?path=${encodeURIComponent(path)}`, {
      method: 'PUT',
      body: JSON.stringify({ content, encoding: 'text' }),
    });
  }
}

// --------------------------------------------------------- browser driver --

class CdpSession {
  #socket;
  #nextId = 1;
  #pending = new Map();

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined && this.#pending.has(message.id)) {
        this.#pending.get(message.id)(message);
        this.#pending.delete(message.id);
      }
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolvePromise, rejectPromise) => {
      socket.addEventListener('open', resolvePromise, { once: true });
      socket.addEventListener('error', rejectPromise, { once: true });
    });
    return new CdpSession(socket);
  }

  send(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolvePromise) => {
      this.#pending.set(id, resolvePromise);
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.#socket.close();
  }
}

// ------------------------------------------------------------------ main --

let server = null;
let chrome = null;
let session = null;
let previousConfig = null;

async function run() {
  try {
    previousConfig = await apiRequest(`/api/file?path=${encodeURIComponent(configPath)}`);
  } catch {
    previousConfig = null;
  }

  await rm(workDirectory, { recursive: true, force: true });
  await mkdir(taskDirectory, { recursive: true });

  for (let id = 1; id <= 12; id += 1) {
    const content = [
      `id=${id}`,
      `title=Browser test task ${id}`,
      'status=todo',
      'tags=browser sample',
      'created=2026-10-01T10:00:00.000Z',
      'updated=2026-10-02T10:00:00.000Z',
      '----',
      `unique-marker-${id}`,
    ].join('\n');
    await apiRequest(`/api/file?path=${encodeURIComponent(`${taskDirectory}/task_${id}.txt`)}`, {
      method: 'POST',
      body: JSON.stringify({ content, encoding: 'text' }),
    });
  }

  await shell(`mkdir -p -- "$HOME/.config/GnumarusProjectManager"`);
  await writeFileEnsured(
    configPath,
    JSON.stringify({ projectDir: taskDirectory, pageSize: 10 }, null, 2),
  );

  const serveDirectory = resolve(workDirectory, 'www');
  await mkdir(serveDirectory, { recursive: true });
  await cp(resolve(projectRoot, 'dist'), serveDirectory, { recursive: true });

  server = spawn(
    'python3',
    ['-m', 'http.server', String(httpPort), '--bind', '127.0.0.1', '--directory', serveDirectory],
    { stdio: 'ignore' },
  );

  chrome = spawn(
    chromeBin,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${resolve(workDirectory, 'chrome-profile')}`,
      '--window-size=1366,768',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  await waitForServer();
  await waitForDebugger();

  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const target = targets.find((candidate) => candidate.type === 'page');
  if (target === undefined) {
    throw new Error('Chrome did not expose a page target');
  }

  session = await CdpSession.connect(target.webSocketDebuggerUrl);
  await session.send('Page.enable');
  await session.send('Runtime.enable');

  const appUrl = `http://127.0.0.1:${httpPort}/index.html`;
  await session.send('Page.navigate', { url: appUrl });
  await delay(1200);
  if (token !== null) {
    await evaluate(`localStorage.setItem('gnumarus-project-manager.token', ${JSON.stringify(token)})`);
    await session.send('Page.reload', { ignoreCache: true });
    await delay(1500);
  }

  await runChecks();
}

async function runChecks() {
  const serviceState = await waitFor(
    `document.querySelector('.service-text')?.textContent === 'Service online'`,
  );
  check(serviceState === true, 'the service is detected as online');

  if (authRequired === false) {
    const tokenButtonHidden = await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')]
        .find((node) => node.textContent.trim() === 'API token');
      return button === undefined || button.hasAttribute('hidden');
    })()`);
    check(
      tokenButtonHidden === true,
      'the application does not ask for a token when the service does not require one',
    );
  }

  const projectPath = await waitFor(
    `document.querySelector('.project-path')?.getAttribute('title') === ${JSON.stringify(taskDirectory)}`,
  );
  check(projectPath === true, 'the project folder of the configuration is loaded');

  await waitFor(`document.querySelectorAll('.task-table tbody tr').length === 10`);
  const rowCount = await evaluate(`document.querySelectorAll('.task-table tbody tr').length`);
  check(rowCount === 10, 'the first page shows ten tasks', `got ${rowCount}`);

  const pageLabel = await evaluate(`document.querySelector('.page-counter')?.textContent`);
  check(pageLabel === '1of2', 'the pagination counter shows page 1 of 2', `got ${pageLabel}`);

  // --- next / previous / first / last ---------------------------------------

  await evaluate(`document.querySelector('[data-page-action="next"]').click()`);
  await waitFor(`document.querySelector('.page-current')?.textContent === '2'`);
  const secondPageRows = await evaluate(`document.querySelectorAll('.task-table tbody tr').length`);
  check(secondPageRows === 2, 'the second page shows the remaining two tasks', `got ${secondPageRows}`);

  await evaluate(`document.querySelector('[data-page-action="first"]').click()`);
  await waitFor(`document.querySelector('.page-current')?.textContent === '1'`);
  check(
    (await evaluate(`document.querySelector('.page-current')?.textContent`)) === '1',
    'the first page button goes back to the first page',
  );

  await evaluate(`document.querySelector('[data-page-action="last"]').click()`);
  await waitFor(`document.querySelector('.page-current')?.textContent === '2'`);
  check(
    (await evaluate(`document.querySelector('.page-current')?.textContent`)) === '2',
    'the last page button goes to the last page',
  );

  await evaluate(`document.querySelector('[data-page-action="previous"]').click()`);
  await waitFor(`document.querySelector('.page-current')?.textContent === '1'`);
  check(
    (await evaluate(`document.querySelector('.page-current')?.textContent`)) === '1',
    'the previous page button goes back one page',
  );

  // --- search ---------------------------------------------------------------

  await evaluate(`(() => {
    const input = document.querySelector('#search-input');
    input.value = 'unique-marker-7';
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Search');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelectorAll('.task-table tbody tr').length === 1`);
  const searchRows = await evaluate(`document.querySelectorAll('.task-table tbody tr').length`);
  check(searchRows === 1, 'the recursive search finds a single task', `got ${searchRows}`);
  const searchTitle = await evaluate(
    `document.querySelector('.task-table tbody .cell-title')?.textContent ?? ''`,
  );
  check(searchTitle.includes('Browser test task 7'), 'the search result is the expected task', searchTitle);

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Clear');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelectorAll('.task-table tbody tr').length === 10`);
  check(
    (await evaluate(`document.querySelectorAll('.task-table tbody tr').length`)) === 10,
    'clearing the search shows every task again',
  );

  // --- create ---------------------------------------------------------------

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'New task');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelector('#task-title') !== null`);
  await evaluate(`(() => {
    document.querySelector('#task-title').value = 'Created by the browser test';
    document.querySelector('#task-tags').value = 'browser created';
    document.querySelector('#task-description').value = 'The description written by the test.';
    return true;
  })()`);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Create task');
    button.click();
    return true;
  })()`);
  await delay(1500);

  const createdPath = `${taskDirectory}/task_13.txt`;
  let createdContent = null;
  try {
    createdContent = await apiRequest(`/api/file?path=${encodeURIComponent(createdPath)}`);
  } catch {
    createdContent = null;
  }
  check(createdContent !== null, 'the new task file was created on disk');
  check(
    createdContent?.content?.includes('title=Created by the browser test') === true,
    'the new task file holds the title',
  );
  check(
    createdContent?.content?.includes('tags=browser created') === true,
    'the new task file holds the tags',
  );

  // --- edit -----------------------------------------------------------------

  await evaluate(`document.querySelector('[data-page-action="last"]').click()`);
  await waitFor(`document.querySelector('tr[data-task-id="13"]') !== null`);
  await evaluate(`(() => {
    const row = document.querySelector('tr[data-task-id="13"]');
    row.querySelectorAll('.row-action')[1].click();
    return true;
  })()`);
  await waitFor(`document.querySelector('#task-title') !== null`);
  await evaluate(`(() => {
    document.querySelector('#task-title').value = 'Edited by the browser test';
    return true;
  })()`);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Save changes');
    button.click();
    return true;
  })()`);
  await delay(1500);

  const editedContent = await apiRequest(`/api/file?path=${encodeURIComponent(createdPath)}`);
  check(
    editedContent.content.includes('title=Edited by the browser test'),
    'the edited title was written to the file',
  );
  check(editedContent.content.includes('id=13'), 'the id of the task was preserved');

  // --- delete ---------------------------------------------------------------

  await evaluate(`(() => {
    const row = document.querySelector('tr[data-task-id="13"]');
    row.querySelectorAll('.row-action')[3].click();
    return true;
  })()`);
  await waitFor(
    `[...document.querySelectorAll('button')].some((node) => node.textContent.trim() === 'Delete')`,
  );
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Delete');
    button.click();
    return true;
  })()`);
  await delay(300);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Yes, delete');
    button.click();
    return true;
  })()`);
  await delay(1500);

  let stillExists = true;
  try {
    await apiRequest(`/api/file?path=${encodeURIComponent(createdPath)}`);
  } catch {
    stillExists = false;
  }
  check(stillExists === false, 'the deleted task file is gone');

  // --- child tasks ----------------------------------------------------------

  await evaluate(`document.querySelector('[data-page-action="first"]').click()`);
  await waitFor(`document.querySelector('.page-current')?.textContent === '1'`);

  await evaluate(`(() => {
    const row = document.querySelector('tr[data-task-id="1"]');
    row.querySelectorAll('.row-action')[2].click();
    return true;
  })()`);
  await waitFor(`document.querySelector('#task-title') !== null`);
  const childBanner = await evaluate(
    `document.querySelector('.task-parent-banner')?.textContent ?? ''`,
  );
  check(childBanner.includes('New child of task #1'), 'the dialog announces the parent task', childBanner);

  await evaluate(`(() => {
    document.querySelector('#task-title').value = 'Child of the first task';
    document.querySelector('#task-description').value = 'Created from the parent task.';
    return true;
  })()`);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Create task');
    button.click();
    return true;
  })()`);
  await delay(1500);

  const childPath = `${taskDirectory}/task_13.txt`;
  const childContent = await apiRequest(`/api/file?path=${encodeURIComponent(childPath)}`);
  check(
    childContent.content.includes('title=Child of the first task'),
    'the child task file was created with its title',
  );
  check(childContent.content.includes('parent=1'), 'the child task file points to its parent');

  await evaluate(`document.querySelector('[data-page-action="last"]').click()`);
  await waitFor(`document.querySelector('.page-current')?.textContent === '2'`);
  const parentLink = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.task-table tbody tr')];
    const row = rows.find((candidate) => candidate.dataset['taskId'] === '13');
    return row?.querySelector('.parent-link')?.textContent ?? '';
  })()`);
  check(parentLink === '#1', 'the listing shows the parent of the child task', parentLink);

  await evaluate(`document.querySelector('[data-page-action="first"]').click()`);
  await waitFor(`document.querySelector('.page-current')?.textContent === '1'`);

  const childBadge = await evaluate(
    `document.querySelector('tr[data-task-id="1"] .child-count')?.textContent ?? ''`,
  );
  check(childBadge.includes('1'), 'the parent task shows how many children it has', childBadge);

  await evaluate(`(() => {
    const row = document.querySelector('tr[data-task-id="1"]');
    row.querySelector('.task-title-button').click();
    return true;
  })()`);
  await waitFor(`document.querySelector('.child-item') !== null`);
  const childTitles = await evaluate(
    `[...document.querySelectorAll('.child-item .child-title')].map((node) => node.textContent).join('|')`,
  );
  check(
    childTitles.includes('Child of the first task'),
    'the parent task lists its children',
    childTitles,
  );
  await evaluate(`document.querySelector('.modal-close').click()`);

  // --- tree view ------------------------------------------------------------

  // A grand child, to check the recursive expansion of a branch.
  const grandChildPath = `${taskDirectory}/task_14.txt`;
  await apiRequest(`/api/file?path=${encodeURIComponent(grandChildPath)}`, {
    method: 'POST',
    body: JSON.stringify({
      content: [
        'id=14',
        'title=Grand child of the first task',
        'status=todo',
        'parent=13',
        'tags=browser sample',
        'created=2026-10-01T10:00:00.000Z',
        'updated=2026-10-01T10:00:00.000Z',
        '----',
        'The grand child of the first task.',
      ].join('\n'),
      encoding: 'text',
    }),
  });

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Tree');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelector('.tree-row') !== null`);

  const treeRoots = await evaluate(
    `[...document.querySelectorAll('.tree-row')].map((node) => node.dataset['taskId']).join('|')`,
  );
  check(
    treeRoots === '1|2|3|4|5|6|7|8|9|10|11|12',
    'the tree shows the tasks that have no parent',
    treeRoots,
  );

  const treeTitles = await evaluate(
    `[...document.querySelectorAll('.tree-row .tree-title')].map((node) => node.textContent).join('|')`,
  );
  check(treeTitles.includes('Browser test task 1'), 'the tree shows the name of the tasks', treeTitles);

  // The child of the first task is hidden until its parent is expanded.
  const childHidden = await evaluate(
    `document.querySelector('.tree-row[data-task-id="13"]') === null`,
  );
  check(childHidden === true, 'the child task is hidden when its parent is collapsed');

  await evaluate(`(() => {
    const row = document.querySelector('.tree-row[data-task-id="1"]');
    row.querySelector('.tree-twisty').click();
    return true;
  })()`);
  await waitFor(`document.querySelector('.tree-row[data-task-id="13"]') !== null`);
  const childDepth = await evaluate(
    `document.querySelector('.tree-row[data-task-id="13"]')?.dataset['depth'] ?? ''`,
  );
  check(childDepth === '1', 'the child task is shown under its parent', childDepth);

  // A simple click keeps the state of the children: the grand child stays
  // hidden because its parent is collapsed.
  const grandChildHidden = await evaluate(
    `document.querySelector('.tree-row[data-task-id="14"]') === null`,
  );
  check(grandChildHidden === true, 'a simple click keeps the state of the children');

  // A ctrl+click collapses the task and all its descendants.
  await evaluate(`(() => {
    const row = document.querySelector('.tree-row[data-task-id="1"]');
    row.querySelector('.tree-twisty')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    return true;
  })()`);
  await waitFor(`document.querySelectorAll('.tree-row').length === 12`);
  check(true, 'a ctrl+click collapses the whole branch');

  // A ctrl+click expands the task and all its descendants.
  await evaluate(`(() => {
    const row = document.querySelector('.tree-row[data-task-id="1"]');
    row.querySelector('.tree-twisty')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    return true;
  })()`);
  await waitFor(`document.querySelector('.tree-row[data-task-id="14"]') !== null`);
  const grandChildDepth = await evaluate(
    `document.querySelector('.tree-row[data-task-id="14"]')?.dataset['depth'] ?? ''`,
  );
  check(grandChildDepth === '2', 'a ctrl+click expands the whole branch', grandChildDepth);

  // Focusing a task makes it the root of the tree.
  await evaluate(`(() => {
    const row = document.querySelector('.tree-row[data-task-id="1"]');
    row.querySelectorAll('.tree-action')[0].click();
    return true;
  })()`);
  await waitFor(`document.querySelectorAll('.tree-row').length === 3`);
  const focusedIds = await evaluate(
    `[...document.querySelectorAll('.tree-row')].map((node) => node.dataset['taskId']).join('|')`,
  );
  check(focusedIds === '1|13|14', 'the focused task is the root of the tree', focusedIds);

  const breadcrumb = await evaluate(
    `[...document.querySelectorAll('.tree-crumb')].map((node) => node.textContent).join('|')`,
  );
  check(
    breadcrumb === 'General root|Browser test task 1',
    'the breadcrumb shows the focused task',
    breadcrumb,
  );

  // The general root shows every task without a parent again.
  await evaluate(`document.querySelector('.tree-crumb').click()`);
  await waitFor(`document.querySelectorAll('.tree-row').length === 12`);

  // The name of a task opens its view.
  await evaluate(`(() => {
    const row = document.querySelector('.tree-row[data-task-id="1"]');
    row.querySelector('.tree-title').click();
    return true;
  })()`);
  await waitFor(`document.querySelector('.modal-title') !== null`);
  const treeModalTitle = await evaluate(`document.querySelector('.modal-title')?.textContent ?? ''`);
  check(
    treeModalTitle.includes('Browser test task 1'),
    'the tree opens the view of a task',
    treeModalTitle,
  );
  await evaluate(`document.querySelector('.modal-close').click()`);

  // --- drag and drop --------------------------------------------------------

  // The grand child (14) is dragged onto the second task (2).
  const dragPoints = await evaluate(`(() => {
    const source = document.querySelector('.tree-row[data-task-id="14"] .tree-title').getBoundingClientRect();
    const target = document.querySelector('.tree-row[data-task-id="2"] .tree-title').getBoundingClientRect();
    return {
      sx: source.left + 12,
      sy: source.top + source.height / 2,
      tx: target.left + 12,
      ty: target.top + target.height / 2,
    };
  })()`);

  const dispatchMouse = (type, x, y) =>
    session.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1,
    });

  await dispatchMouse('mousePressed', dragPoints.sx, dragPoints.sy);
  await delay(150);
  await dispatchMouse('mouseMoved', dragPoints.sx + 30, dragPoints.sy - 20);
  await delay(150);
  await dispatchMouse('mouseMoved', dragPoints.tx, dragPoints.ty);
  await delay(400);

  const dropTarget = await evaluate(
    `document.querySelector('.tree-row.tree-drop-target')?.dataset['taskId'] ?? ''`,
  );
  check(dropTarget === '2', 'the row under the pointer is the drop target', dropTarget);

  await dispatchMouse('mouseReleased', dragPoints.tx, dragPoints.ty);
  await delay(1500);

  const movedContent = await apiRequest(
    `/api/file?path=${encodeURIComponent(`${taskDirectory}/task_14.txt`)}`,
  );
  check(
    movedContent.content.includes('parent=2'),
    'the dragged task is now a child of the task it was dropped on',
    movedContent.content,
  );

  // Back to the flat list for the rest of the test.
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'List');
    button.click();
    return true;
  })()`);
  // The pagination bar comes back when the list is drawn again.
  await waitFor(`document.querySelector('.pagination-footer')?.hasAttribute('hidden') === false`);
  await waitFor(`document.querySelector('.page-current')?.textContent === '1'`);

  await evaluate(`document.querySelector('[data-page-action="last"]').click()`);
  await waitFor(`document.querySelector('.page-current')?.textContent === '2'`);
  await waitFor(`document.querySelector('tr[data-task-id="13"]') !== null`);
  await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.task-table tbody tr')];
    const row = rows.find((candidate) => candidate.dataset['taskId'] === '13');
    row.querySelectorAll('.row-action')[3].click();
    return true;
  })()`);
  await waitFor(
    `[...document.querySelectorAll('button')].some((node) => node.textContent.trim() === 'Delete')`,
  );
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Delete');
    button.click();
    return true;
  })()`);
  await delay(300);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Yes, delete');
    button.click();
    return true;
  })()`);
  await delay(1200);

  // --- screenshots ----------------------------------------------------------

  await capture('browser');
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'New task');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelector('#task-title') !== null`);
  await capture('task-dialog');
  await evaluate(`document.querySelector('.modal-close').click()`);

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Choose folder…');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelector('.fd-list') !== null`);
  await delay(800);
  await capture('file-dialog');

  // --- the folder picker ----------------------------------------------------

  // The parent of the task folder holds the "tasks" directory.
  const parentDirectory = taskDirectory.replace(/\/[^/]+$/u, '');

  await evaluate(`(() => {
    const input = document.querySelector('.path-input');
    input.value = ${JSON.stringify(parentDirectory)};
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
  await waitFor(
    `[...document.querySelectorAll('.fd-entry-name')].some((node) => node.textContent === 'tasks')`,
  );

  // Clicking an item does not rebuild the list: the scroll cannot be reset.
  await evaluate(`(() => {
    const list = document.querySelector('.fd-list');
    window.__fdRow = [...list.querySelectorAll('.fd-entry')]
      .find((node) => node.querySelector('.fd-entry-name').textContent === 'tasks');
    window.__fdRow.click();
    return true;
  })()`);
  await delay(300);
  const listKept = await evaluate(
    `document.querySelector('.fd-list').contains(window.__fdRow)
      && window.__fdRow.classList.contains('fd-entry-selected')`,
  );
  check(listKept === true, 'clicking an item does not rebuild the list of the dialog');

  // Enter enters the selected directory.
  await evaluate(
    `document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`,
  );
  await waitFor(`document.querySelector('.path-input').value.endsWith('/tasks')`);
  const enteredPath = await evaluate(`document.querySelector('.path-input').value`);
  check(enteredPath.endsWith('/tasks'), 'Enter enters the selected folder', enteredPath);

  await evaluate(`document.querySelector('.modal-close').click()`);
}

async function capture(name) {
  const shot = await session.send('Page.captureScreenshot', { format: 'png' });
  const path = resolve(projectRoot, `tmp/e2e-${name}-screenshot.png`);
  await writeFile(path, Buffer.from(shot.result.data, 'base64'));
  console.log(`A screenshot was written to ${path}`);
}

async function evaluate(expression) {
  const response = await session.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.result?.exceptionDetails !== undefined) {
    throw new Error(
      `Evaluation failed: ${response.result.exceptionDetails.exception?.description ?? 'unknown error'}`,
    );
  }
  return response.result?.result?.value;
}

async function waitFor(expression, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await evaluate(`(() => { try { return ${expression}; } catch { return null; } })()`);
    if (value !== null && value !== false && value !== undefined) {
      return value;
    }
    await delay(150);
  }
  return null;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${httpPort}/index.html`);
      if (response.ok) {
        return;
      }
    } catch {
      // not ready yet
    }
    await delay(200);
  }
  throw new Error('The static server did not start');
}

async function waitForDebugger() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) {
        return;
      }
    } catch {
      // not ready yet
    }
    await delay(200);
  }
  throw new Error('Chrome did not start');
}

// ------------------------------------------------------------------ run ---

let fatalError = null;

try {
  await run();
} catch (error) {
  fatalError = error;
} finally {
  session?.close();
  server?.kill();
  chrome?.kill();

  if (previousConfig !== null) {
    await apiRequest(`/api/file?path=${encodeURIComponent(configPath)}`, {
      method: 'PUT',
      body: JSON.stringify({ content: previousConfig.content, encoding: 'text' }),
    }).catch(() => {
      console.error('The previous configuration could not be restored.');
    });
  } else {
    await shell(`rm -f -- "$HOME/.config/GnumarusProjectManager/config.json"`).catch(() => {
      console.error('The configuration file could not be removed.');
    });
  }

  await delay(500);
  await rm(workDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(
    () => {
      // The browser may still hold a few profile files: they are removed later.
    },
  );
}

if (fatalError !== null) {
  console.error(fatalError instanceof Error ? fatalError.message : String(fatalError));
  process.exitCode = 1;
}

console.log('');
console.log(`${checks.length - failures}/${checks.length} checks passed.`);
if (failures > 0) {
  process.exitCode = 1;
}
