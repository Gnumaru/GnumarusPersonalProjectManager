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
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
    // The tasks have a start and an end date, so the Gantt chart has a
    // schedule to draw.
    const start = `202610${String(id + 1).padStart(2, '0')}090000000`;
    const end = `202610${String(id + 6).padStart(2, '0')}180000000`;
    const content = [
      `id=${id}`,
      `title=Browser test task ${id}`,
      'status=todo',
      'tags=browser sample',
      'created=20261001100000000',
      'updated=20261002100000000',
      `start=${start}`,
      `end=${end}`,
      '----',
      `unique-marker-${id}`,
    ].join('\n');
    await apiRequest(`/api/file?path=${encodeURIComponent(`${taskDirectory}/task_${id}.txt`)}`, {
      method: 'POST',
      body: JSON.stringify({ content, encoding: 'text' }),
    });
  }

  // The notes: one of them holds the term in its title, the other one in its
  // body.
  for (let id = 1; id <= 12; id += 1) {
    const content = [
      `id=${id}`,
      `title=Browser test note ${id}`,
      'created=20261001100000000',
      'updated=20261002100000000',
      '----',
      id === 1 ? 'A body with a needle in it' : `note-body-${id}`,
    ].join('\n');
    await apiRequest(`/api/file?path=${encodeURIComponent(`${taskDirectory}/note_${id}.txt`)}`, {
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
  const datePickers = await evaluate(
    `document.querySelector('#task-start')?.getAttribute('type') + '/' + document.querySelector('#task-end')?.getAttribute('type')`,
  );
  check(
    datePickers === 'date/date',
    'the editor holds a date picker for the start and for the end date',
    datePickers,
  );
  await evaluate(`(() => {
    document.querySelector('#task-title').value = 'Created by the browser test';
    document.querySelector('#task-tags').value = 'browser created';
    document.querySelector('#task-description').value = 'The description written by the test.';
    document.querySelector('#task-start').value = '2026-10-19';
    document.querySelector('#task-end').value = '2026-10-23';
    return true;
  })()`);
  // A task that blocks the new one and a task that is related to it.
  await evaluate(`(() => {
    const fields = [...document.querySelectorAll('.id-list')];
    const blocked = fields[0].querySelector('.id-list-input');
    blocked.value = '2';
    blocked.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const related = fields[1].querySelector('.id-list-input');
    related.value = '3';
    related.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
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
  check(
    createdContent?.content?.includes('start=20261019000000000') === true,
    'the new task file holds the start date',
    createdContent?.content,
  );
  check(
    createdContent?.content?.includes('end=20261023000000000') === true,
    'the new task file holds the end date',
    createdContent?.content,
  );
  check(
    createdContent?.content?.includes('blocked_by=2') === true,
    'the new task file holds the tasks that block it',
    createdContent?.content,
  );
  check(
    createdContent?.content?.includes('related=3') === true,
    'the new task file holds the tasks that are related to it',
    createdContent?.content,
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
  // A comment is added to the task.
  await evaluate(`(() => {
    const editor = document.querySelector('.task-comment-new');
    editor.value = 'A comment written by the browser test.';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Add comment');
    button.click();
    return true;
  })()`);
  await delay(1200);
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

  const commentContent = await apiRequest(
    `/api/file?path=${encodeURIComponent(`${taskDirectory}/comment_1.txt`)}`,
  );
  check(
    commentContent.content.includes('task=13'),
    'the comment is written in a file of its own',
    commentContent.content,
  );
  check(
    commentContent.content.includes('A comment written by the browser test.'),
    'the comment holds its text',
    commentContent.content,
  );

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

  // The task is dragged on the general root: it becomes a root task again.
  await evaluate(`(() => {
    const row = document.querySelector('.tree-row[data-task-id="2"]');
    row.querySelector('.tree-twisty').click();
    return true;
  })()`);
  await waitFor(`document.querySelector('.tree-row[data-task-id="14"]') !== null`);

  const rootPoints = await evaluate(`(() => {
    const source = document.querySelector('.tree-row[data-task-id="14"] .tree-title').getBoundingClientRect();
    const target = document.querySelector('.tree-root-target').getBoundingClientRect();
    return {
      sx: source.left + 12,
      sy: source.top + source.height / 2,
      tx: target.left + 12,
      ty: target.top + target.height / 2,
    };
  })()`);

  await dispatchMouse('mousePressed', rootPoints.sx, rootPoints.sy);
  await delay(150);
  await dispatchMouse('mouseMoved', rootPoints.sx + 20, rootPoints.sy - 20);
  await delay(150);
  await dispatchMouse('mouseMoved', rootPoints.tx, rootPoints.ty);
  await delay(400);
  await dispatchMouse('mouseReleased', rootPoints.tx, rootPoints.ty);
  await delay(1500);

  const detachedContent = await apiRequest(
    `/api/file?path=${encodeURIComponent(`${taskDirectory}/task_14.txt`)}`,
  );
  check(
    !detachedContent.content.includes('parent='),
    'the task dropped on the general root becomes a root task',
    detachedContent.content,
  );

  // --- board ----------------------------------------------------------------

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Kanban');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelector('.kanban-column') !== null`);

  const boardColumns = await evaluate(
    `[...document.querySelectorAll('.kanban-column')].map((node) => node.dataset['status']).join('|')`,
  );
  check(
    boardColumns === 'planning|todo|next|paused|doing|done|canceled',
    'the board has one column per status, in the expected order',
    boardColumns,
  );

  // The task 1 has a child: it is not on the board.
  const parentOnBoard = await evaluate(
    `document.querySelector('.kanban-card[data-task-id="1"]') !== null`,
  );
  check(parentOnBoard === false, 'the tasks that have a child are not on the board');

  // The card of the second task is dragged on the DOING column.
  const boardPoints = await evaluate(`(() => {
    const source = document.querySelector('.kanban-card[data-task-id="2"] .kanban-card-title').getBoundingClientRect();
    const target = document.querySelector('.kanban-column[data-status="doing"] .kanban-cards').getBoundingClientRect();
    return {
      sx: source.left + 12,
      sy: source.top + source.height / 2,
      tx: target.left + 60,
      ty: target.top + 30,
    };
  })()`);

  await dispatchMouse('mousePressed', boardPoints.sx, boardPoints.sy);
  await delay(150);
  await dispatchMouse('mouseMoved', boardPoints.sx + 30, boardPoints.sy - 20);
  await delay(150);
  await dispatchMouse('mouseMoved', boardPoints.tx, boardPoints.ty);
  await delay(400);

  const highlightedColumn = await evaluate(
    `document.querySelector('.kanban-column.tree-drop-target')?.dataset['status'] ?? ''`,
  );
  check(highlightedColumn === 'doing', 'the column under the pointer is the drop target', highlightedColumn);

  await dispatchMouse('mouseReleased', boardPoints.tx, boardPoints.ty);
  await delay(1500);

  const movedStatus = await apiRequest(
    `/api/file?path=${encodeURIComponent(`${taskDirectory}/task_2.txt`)}`,
  );
  check(
    movedStatus.content.includes('status=doing'),
    'the card dropped on a column changes the status of the task',
    movedStatus.content,
  );

  // --- gantt chart ----------------------------------------------------------

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Gantt');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelector('.gantt-wrap') !== null`);

  const ganttMonths = await evaluate(
    `[...document.querySelectorAll('.gantt-month')].map((node) => node.textContent).join('|')`,
  );
  check(
    ganttMonths === '9September|10October',
    'the months are numbered with the number of the month of the year',
    ganttMonths,
  );

  const ganttWeeks = await evaluate(
    `[...document.querySelectorAll('.gantt-week')].map((node) => node.textContent).join('|')`,
  );
  check(
    /^40[A-Z]/.test(ganttWeeks),
    'the weeks are numbered from the first day of the year',
    ganttWeeks,
  );

  const ganttBars = await evaluate(`document.querySelectorAll('.gantt-bar').length`);
  check(ganttBars > 0, 'the Gantt chart draws a bar for every task', `${ganttBars}`);

  const ganttRows = await evaluate(`document.querySelectorAll('.gantt-row').length`);
  check(ganttRows > 0, 'the Gantt chart shows the tasks on the left', `${ganttRows}`);

  // A ctrl+click on the twisty expands or collapses the whole branch of the
  // task, the task and all its descendants.
  const twisty = await evaluate(`(() => {
    const node = document.querySelector('.gantt-row .gantt-twisty');
    const box = node.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  })()`);
  const ctrlClick = async () => {
    await session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: twisty.x,
      y: twisty.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
      modifiers: 2,
    });
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: twisty.x,
      y: twisty.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
      modifiers: 2,
    });
    await delay(700);
    return evaluate(`document.querySelectorAll('.gantt-row').length`);
  };

  const rowsBefore = await evaluate(`document.querySelectorAll('.gantt-row').length`);
  const rowsCollapsed = await ctrlClick();
  check(
    rowsCollapsed !== rowsBefore,
    'a ctrl+click collapses the whole branch of a task in the Gantt chart',
    `${rowsBefore} -> ${rowsCollapsed}`,
  );

  const rowsExpanded = await ctrlClick();
  check(
    rowsExpanded === rowsBefore,
    'a ctrl+click expands the whole branch of a task in the Gantt chart',
    `${rowsCollapsed} -> ${rowsExpanded}`,
  );

  // A week can be collapsed: its days are not drawn any more.
  const daysBefore = await evaluate(`document.querySelectorAll('.gantt-day').length`);
  await evaluate(`document.querySelector('.gantt-week').click()`);
  await delay(500);
  const daysAfter = await evaluate(`document.querySelectorAll('.gantt-day').length`);
  check(
    daysAfter < daysBefore,
    'collapsing a week hides its days',
    `${daysBefore} -> ${daysAfter}`,
  );

  await evaluate(`document.querySelector('.gantt-week').click()`);
  await delay(500);
  const daysAgain = await evaluate(`document.querySelectorAll('.gantt-day').length`);
  check(daysAgain === daysBefore, 'expanding the week shows its days again', `${daysAgain}`);

  // The days alternate between a white and a very light grey background.
  const stripes = await evaluate(`document.querySelectorAll('.gantt-stripe').length`);
  const alternateDays = await evaluate(
    `document.querySelectorAll('.gantt-day.is-alt').length`,
  );
  check(
    stripes > 0 && alternateDays === stripes,
    'the day columns alternate between two colours',
    `${alternateDays} of ${daysBefore}`,
  );

  // Clicking a month collapses every week that holds a day of it.
  const weeksBefore = await evaluate(`document.querySelectorAll('.gantt-week').length`);
  await evaluate(`document.querySelector('.gantt-month').click()`);
  await delay(500);
  const collapsedWeeks = await evaluate(
    `document.querySelectorAll('.gantt-week.is-collapsed').length`,
  );
  check(
    collapsedWeeks > 0 && collapsedWeeks < weeksBefore,
    'clicking a month collapses the weeks that hold a day of it',
    `${collapsedWeeks} of ${weeksBefore}`,
  );
  check(
    (await evaluate(`document.querySelectorAll('.gantt-month.is-collapsed').length`)) === 0,
    'the months are not collapsed themselves',
  );
  await evaluate(`document.querySelector('.gantt-month').click()`);
  await delay(500);

  // The bar of a task can be dragged to change its dates.
  const barPoint = await evaluate(`(() => {
    const bar = document.querySelector('.gantt-bar[data-task-id="1"]');
    const box = bar.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  })()`);
  await dispatchMouse('mousePressed', barPoint.x, barPoint.y);
  await delay(150);
  await dispatchMouse('mouseMoved', barPoint.x + 2 * 28, barPoint.y);
  await delay(300);
  await dispatchMouse('mouseReleased', barPoint.x + 2 * 28, barPoint.y);
  await delay(1200);

  const dragged = await apiRequest(
    `/api/file?path=${encodeURIComponent(`${taskDirectory}/task_1.txt`)}`,
  );
  check(
    dragged.content.includes('start=20261004000000000') &&
      dragged.content.includes('end=20261009000000000'),
    'dragging a bar moves the dates of the task',
    dragged.content,
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

  await checkNotes();
  await checkEmbeddedProject();
}

/**
 * Checks the notes: the display mode, the listing, the pagination, the search
 * and the editor.
 */
async function checkNotes() {
  // --- the display mode ------------------------------------------------------

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Notes');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelectorAll('.note-table tbody tr').length === 10`);
  check(true, 'the notes mode shows the notes of the project');
  await capture('notes');

  const scopeVisible = await evaluate(
    `document.querySelector('#note-scope')?.hasAttribute('hidden') === false`,
  );
  check(scopeVisible === true, 'the scope of the search of the notes is shown');

  const newButton = await evaluate(
    `[...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'New note') !== undefined`,
  );
  check(newButton === true, 'the toolbar creates a note in the notes mode');

  // --- the pagination --------------------------------------------------------

  const summary = await evaluate(`document.querySelector('.pagination-summary')?.textContent`);
  check(summary === 'Showing 1-10 of 12 notes', 'the notes are paginated, ten per page', String(summary));

  await evaluate(`document.querySelector('[data-page-action="next"]').click()`);
  await waitFor(`document.querySelector('.page-current')?.textContent === '2'`);
  check(
    (await evaluate(`document.querySelectorAll('.note-table tbody tr').length`)) === 2,
    'the second page shows the remaining notes',
  );

  await evaluate(`document.querySelector('[data-page-action="first"]').click()`);
  await waitFor(`document.querySelector('.page-current')?.textContent === '1'`);

  // The input that jumps to a page number.
  await evaluate(`(() => {
    const field = document.querySelector('.page-jump-input');
    field.value = '2';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
  await waitFor(`document.querySelector('.page-current')?.textContent === '2'`);
  check(true, 'the input jumps to the page the user types');

  await evaluate(`document.querySelector('[data-page-action="first"]').click()`);
  await waitFor(`document.querySelector('.page-current')?.textContent === '1'`);

  // --- the search ------------------------------------------------------------

  await evaluate(`(() => {
    const input = document.querySelector('#search-input');
    input.value = 'needle';
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Search');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelectorAll('.note-table tbody tr').length === 1`);
  check(true, 'the search finds the note whose body holds the term');

  // The scope of the search: the title only.
  await evaluate(`(() => {
    const scope = document.querySelector('#note-scope');
    scope.value = 'title';
    scope.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(`document.querySelectorAll('.note-table tbody tr').length === 0`);
  check(true, 'the search of the titles does not find the note whose body holds the term');

  await evaluate(`(() => {
    const scope = document.querySelector('#note-scope');
    scope.value = 'content';
    scope.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(`document.querySelectorAll('.note-table tbody tr').length === 1`);
  check(true, 'the search of the bodies finds the note whose body holds the term');

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Clear');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelectorAll('.note-table tbody tr').length === 10`);

  // --- the editor ------------------------------------------------------------

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'New note');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelector('#note-title') !== null`);

  await evaluate(`(() => {
    document.querySelector('#note-title').value = 'A note of the browser test';
    document.querySelector('#note-content').value = '# The heading\\n\\nSome **bold** text.';
    return true;
  })()`);

  // The preview shows the markdown.
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Preview');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelector('.note-preview h1') !== null`);
  const heading = await evaluate(`document.querySelector('.note-preview h1')?.textContent`);
  check(heading === 'The heading', 'the preview shows the note as markdown', String(heading));
  await capture('note-preview');

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Create note');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelector('.result-count')?.textContent === '13 notes'`);

  // The new note is the last one: it is on the second page.
  await evaluate(`document.querySelector('[data-page-action="last"]').click()`);
  await waitFor(`document.querySelector('.page-current')?.textContent === '2'`);
  const created = await evaluate(
    `[...document.querySelectorAll('.note-table tbody .cell-title')].some((node) => node.textContent.includes('A note of the browser test'))`,
  );
  check(created === true, 'the note is created and listed');

  // The file of the note is on the disk, with its id inside.
  const noteFile = await apiRequest(
    `/api/file?path=${encodeURIComponent(`${taskDirectory}/note_13.txt`)}`,
  );
  check(
    String(noteFile.content ?? '').includes('id=13') &&
      String(noteFile.content ?? '').includes('title=A note of the browser test'),
    'the file of the note holds its id and its title',
  );

  // The note is deleted.
  await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.note-table tbody tr')];
    const row = rows.find((node) => node.textContent.includes('A note of the browser test'));
    row.querySelectorAll('.row-action')[2].click();
    return true;
  })()`);
  await waitFor(`document.querySelector('.note-dialog') !== null`);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Delete');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelector('.dialog-confirm') !== null`);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Yes, delete');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelector('.result-count')?.textContent === '12 notes'`);
  const deleted = await evaluate(
    `[...document.querySelectorAll('.note-table tbody .cell-title')].some((node) => node.textContent.includes('A note of the browser test'))`,
  );
  check(deleted === false, 'the note is deleted');

  // Back to the tasks.
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'List');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelectorAll('.task-table tbody tr').length === 10`);
}

/**
 * Checks the embedded project: the switch to the browser, the creation of a
 * task, the export of a ZIP archive and the import of that archive.
 */
async function checkEmbeddedProject() {
  // --- the dialog of the project --------------------------------------------

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Project…');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelectorAll('.project-choice').length === 2`);
  const choices = await evaluate(
    `[...document.querySelectorAll('.project-choice-title')].map((node) => node.textContent).join(' | ')`,
  );
  check(
    typeof choices === 'string' && choices.includes('embedded'),
    'the dialog of the project offers the embedded project',
    String(choices),
  );
  await capture('project-dialog');

  // --- the switch to the embedded project -----------------------------------

  await evaluate(`(() => {
    const choices = [...document.querySelectorAll('.project-choice')];
    choices[1].click();
    return true;
  })()`);
  await waitFor(`document.querySelector('.project-path')?.textContent === 'Embedded project'`);
  check(true, 'the project is now the embedded project');

  const folderPickerHidden = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.topbar-project button')]
      .find((node) => node.textContent.trim() === 'Choose folder…');
    return button === undefined || button.hasAttribute('hidden');
  })()`);
  check(folderPickerHidden === true, 'the folder picker is hidden in the embedded mode');

  // --- a task of the embedded project ---------------------------------------

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'New task');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelector('#task-title') !== null`);
  await evaluate(`(() => {
    document.querySelector('#task-title').value = 'A task of the embedded project';
    return true;
  })()`);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Create task');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelectorAll('.task-table tbody tr').length === 1`);
  const embeddedTitle = await evaluate(`document.querySelector('.task-title-button')?.textContent`);
  check(
    embeddedTitle === 'A task of the embedded project',
    'the task of the embedded project is listed',
    String(embeddedTitle),
  );

  // The file of the task lives in the storage of the browser.
  const storedFile = await evaluate(`(async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('task_1.txt');
    const file = await handle.getFile();
    return await file.text();
  })()`);
  check(
    typeof storedFile === 'string' && storedFile.includes('title=A task of the embedded project'),
    'the file of the task is in the storage of the browser',
  );

  // --- the export of the ZIP archive ----------------------------------------

  const downloadDirectory = resolve(workDirectory, 'downloads');
  await mkdir(downloadDirectory, { recursive: true });
  await session.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDirectory,
  });
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Project…');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelectorAll('.project-choice').length === 2`);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Download the project');
    button.click();
    return true;
  })()`);

  const archivePath = resolve(downloadDirectory, 'project.zip');
  let archive = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    archive = await readFile(archivePath).catch(() => null);
    if (archive !== null) {
      break;
    }
    await delay(250);
  }
  check(archive !== null, 'the ZIP archive of the project was downloaded');

  if (archive !== null) {
    const entries = listZipEntries(archive);
    check(
      entries.includes('task_1.txt'),
      'the archive holds the file of the task',
      entries.join(', '),
    );
    const content = readZipEntry(archive, 'task_1.txt');
    check(
      content !== null && content.includes('title=A task of the embedded project'),
      'the file of the archive holds the same content as the file of the browser',
    );
  }

  // --- the import of the ZIP archive ----------------------------------------

  // A second task, that the import is going to discard.
  await evaluate(`document.querySelector('.modal-close')?.click()`);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'New task');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelector('#task-title') !== null`);
  await evaluate(`(() => {
    document.querySelector('#task-title').value = 'A task that will be discarded';
    return true;
  })()`);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Create task');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelectorAll('.task-table tbody tr').length === 2`);
  check(true, 'the embedded project holds two tasks');

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Project…');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelector('.project-file-input') !== null`);
  await session.send('DOM.enable');
  const document_ = await session.send('DOM.getDocument');
  const input_ = await session.send('DOM.querySelector', {
    nodeId: document_.result.root.nodeId,
    selector: '.project-file-input',
  });
  await session.send('DOM.setFileInputFiles', {
    files: [archivePath],
    nodeId: input_.result.nodeId,
  });

  await waitFor(`document.querySelectorAll('.task-table tbody tr').length === 1`);
  const importedTitle = await evaluate(`document.querySelector('.task-title-button')?.textContent`);
  check(
    importedTitle === 'A task of the embedded project',
    'the import of the archive replaces the whole embedded project',
    String(importedTitle),
  );

  // --- the switch back to the service ---------------------------------------

  await evaluate(`document.querySelector('.modal-close')?.click()`);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Project…');
    button.click();
    return true;
  })()`);
  await waitFor(`document.querySelectorAll('.project-choice').length === 2`);
  await evaluate(`(() => {
    const choices = [...document.querySelectorAll('.project-choice')];
    choices[0].click();
    return true;
  })()`);
  await waitFor(`document.querySelector('.project-path')?.getAttribute('title') === ${JSON.stringify(taskDirectory)}`);
  const serviceRows = await evaluate(`document.querySelectorAll('.task-table tbody tr').length`);
  check(serviceRows === 10, 'the tasks of the service are shown again', `got ${serviceRows}`);
  await evaluate(`document.querySelector('.modal-close')?.click()`);
}

/** The names of the files of a ZIP archive. */
function listZipEntries(archive) {
  const names = [];
  let position = archive.length - 22;
  while (position >= 0) {
    if (archive.readUInt32LE(position) === 0x06054b50) {
      const count = archive.readUInt16LE(position + 10);
      let entry = archive.readUInt32LE(position + 16);
      for (let index = 0; index < count; index += 1) {
        if (archive.readUInt32LE(entry) !== 0x02014b50) {
          break;
        }
        const nameLength = archive.readUInt16LE(entry + 28);
        const extraLength = archive.readUInt16LE(entry + 30);
        const commentLength = archive.readUInt16LE(entry + 32);
        names.push(archive.subarray(entry + 46, entry + 46 + nameLength).toString('utf8'));
        entry += 46 + nameLength + extraLength + commentLength;
      }
      break;
    }
    position -= 1;
  }
  return names;
}

/** The content of a file of a ZIP archive, `null` when it is not there. */
function readZipEntry(archive, name) {
  const entries = listZipEntries(archive);
  if (!entries.includes(name)) {
    return null;
  }
  let position = archive.length - 22;
  while (position >= 0) {
    if (archive.readUInt32LE(position) === 0x06054b50) {
      const count = archive.readUInt16LE(position + 10);
      let entry = archive.readUInt32LE(position + 16);
      for (let index = 0; index < count; index += 1) {
        const nameLength = archive.readUInt16LE(entry + 28);
        const extraLength = archive.readUInt16LE(entry + 30);
        const commentLength = archive.readUInt16LE(entry + 32);
        const size = archive.readUInt32LE(entry + 24);
        const localOffset = archive.readUInt32LE(entry + 42);
        const entryName = archive.subarray(entry + 46, entry + 46 + nameLength).toString('utf8');
        if (entryName === name) {
          const localNameLength = archive.readUInt16LE(localOffset + 26);
          const localExtraLength = archive.readUInt16LE(localOffset + 28);
          const start = localOffset + 30 + localNameLength + localExtraLength;
          return archive.subarray(start, start + size).toString('utf8');
        }
        entry += 46 + nameLength + extraLength + commentLength;
      }
      break;
    }
    position -= 1;
  }
  return null;
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
