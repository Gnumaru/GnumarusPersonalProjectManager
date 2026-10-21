import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vite-plus/test';
import { ApiClient } from '../api/client.js';
import { FakeBridge } from '../test-support/fakeBridge.js';
import { App, shortenPath, type TokenStorage } from './app.js';

class MemoryStorage implements TokenStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

interface Harness {
  readonly app: App;
  readonly bridge: FakeBridge;
  readonly doc: Document;
  readonly root: HTMLElement;
  readonly dom: JSDOM;
}

interface HarnessOptions {
  /** Token stored in the browser. `null` means no token at all. */
  readonly token?: string | null;
  /** Whether the fake service demands a token (default: `true`). */
  readonly authRequired?: boolean;
  /** Content of the configuration file present on the fake disk. */
  readonly config?: string;
  /** Routes of the fake that always answer `401`. */
  readonly rejectPaths?: readonly string[];
  /** The tasks created on the fake disk. */
  readonly tasks?: readonly { readonly id: number; readonly parentId?: number }[];
}

function taskContent(id: number, parentId: number | null = null): string {
  const lines = [`id=${id}`, `title=Task ${id}`, 'status=todo'];
  if (parentId !== null) {
    lines.push(`parent=${parentId}`);
  }
  lines.push(
    `tags=tag${id}`,
    'created=2026-10-01T10:00:00.000Z',
    'updated=2026-10-02T10:00:00.000Z',
    '----',
    `marker-${id}`,
  );
  return lines.join('\n');
}

async function createHarness(taskCount = 25, options: HarnessOptions = {}): Promise<Harness> {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const doc = dom.window.document;
  const root = doc.createElement('div');
  doc.body.append(root);

  const token = options.token === undefined ? 'test-token' : options.token;
  const bridge = new FakeBridge({
    token,
    authRequired: options.authRequired ?? true,
    rejectPaths: options.rejectPaths ?? [],
  });
  bridge.directories.add('/home/user');
  bridge.directories.add('/home/user/projects');
  if (options.tasks !== undefined) {
    for (const task of options.tasks) {
      bridge.addFile(
        `/home/user/projects/task_${task.id}.txt`,
        taskContent(task.id, task.parentId ?? null),
      );
    }
  } else {
    for (let id = 1; id <= taskCount; id += 1) {
      bridge.addFile(`/home/user/projects/task_${id}.txt`, taskContent(id));
    }
  }
  if (options.config !== undefined) {
    bridge.addFile('~/.config/GnumarusProjectManager/config.json', options.config);
  }

  const api = new ApiClient({ baseUrl: bridge.baseUrl, token, fetchImpl: bridge.fetch });
  const storage = new MemoryStorage();
  if (token !== null) {
    storage.setItem('gnumarus-project-manager.token', token);
  }

  const app = new App({ doc, root, api, storage });
  await app.start();

  return { app, bridge, doc, root, dom };
}

async function flush(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function click(element: Element | null | undefined): void {
  if (element === null || element === undefined) {
    return;
  }
  const clickable = element as { click?: () => void };
  clickable.click?.();
}

function doubleClick(element: Element | null | undefined, dom: JSDOM): void {
  if (element === null || element === undefined) {
    return;
  }
  element.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
}

/** Clicks an element while the control key is held down. */
function ctrlClick(element: Element | null | undefined, dom: JSDOM): void {
  if (element === null || element === undefined) {
    return;
  }
  element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, ctrlKey: true }));
}

/** Drags a row of the tree onto another one, as the mouse would do. */
function dragTask(harness: Harness, draggedId: number, targetId: number): void {
  const source = harness.root.querySelector<HTMLElement>(
    `.tree-row[data-task-id="${draggedId}"] .tree-title`,
  );
  const target = harness.root.querySelector<HTMLElement>(`.tree-row[data-task-id="${targetId}"]`);
  if (source === null || target === null) {
    return;
  }
  const event = (type: string, node: HTMLElement, x: number, y: number): void => {
    node.dispatchEvent(
      new harness.dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }),
    );
  };
  event('mousedown', source, 10, 10);
  event('mousemove', target, 60, 60);
  event('mouseup', target, 60, 60);
}

function buttonByText(doc: Document, text: string): HTMLButtonElement | null {
  const buttons = [...doc.querySelectorAll('button')];
  return buttons.find((button) => button.textContent?.trim() === text) ?? null;
}

describe('shortenPath', () => {
  it('keeps a short path untouched', () => {
    expect(shortenPath('/home/user/tasks', 52)).toBe('/home/user/tasks');
  });

  it('keeps the end of a long path', () => {
    const shortened = shortenPath('/home/user/a/very/long/path/that/does/not/fit/in/the/top/bar', 20);
    expect(shortened.startsWith('…')).toBe(true);
    expect(shortened).toHaveLength(20);
    expect(shortened.endsWith('top/bar')).toBe(true);
  });
});

describe('App', () => {
  it('shows the service as online and asks for a folder', async () => {
    const harness = await createHarness(0);
    expect(harness.root.querySelector('.service-text')?.textContent).toBe('Service online');
    expect(harness.root.querySelector('.empty-title')?.textContent).toBe(
      'Choose the folder that will hold your tasks',
    );
    harness.app.dispose();
  });

  it('notifies the user when the service is unreachable', async () => {
    const harness = await createHarness(0);
    harness.bridge.offline = true;
    await harness.app.start();
    await flush();
    expect(harness.root.querySelector('.banner')?.hasAttribute('hidden')).toBe(false);
    expect(harness.root.querySelector('.banner-text')?.textContent).toContain('not reachable');
    harness.app.dispose();
  });

  it('lists the tasks of the selected folder, ten per page', async () => {
    const harness = await createHarness(25);
    await selectFolder(harness);

    const rows = harness.root.querySelectorAll('.task-table tbody tr');
    expect(rows).toHaveLength(10);
    expect(harness.root.querySelector('.page-current')?.textContent).toBe('1');
    expect(harness.root.querySelector('.page-total')?.textContent).toBe('3');
    expect(harness.root.querySelector('.pagination-summary')?.textContent).toBe(
      'Showing 1-10 of 25',
    );
    expect(harness.root.querySelector('.result-count')?.textContent).toBe('25 tasks');
    harness.app.dispose();
  });

  it('moves between the pages', async () => {
    const harness = await createHarness(25);
    await selectFolder(harness);

    const next = harness.root.querySelector<HTMLButtonElement>('.pagination-controls .page-button:nth-of-type(3)');
    click(next);
    await flush();
    expect(harness.root.querySelector('.page-current')?.textContent).toBe('2');
    expect(harness.root.querySelectorAll('.task-table tbody tr')).toHaveLength(10);
    expect(harness.root.querySelector('.pagination-summary')?.textContent).toBe(
      'Showing 11-20 of 25',
    );

    const last = harness.root.querySelector<HTMLButtonElement>('.page-last');
    click(last);
    await flush();
    expect(harness.root.querySelector('.page-current')?.textContent).toBe('3');
    expect(harness.root.querySelectorAll('.task-table tbody tr')).toHaveLength(5);

    const first = harness.root.querySelector<HTMLButtonElement>('.page-first');
    click(first);
    await flush();
    expect(harness.root.querySelector('.page-current')?.textContent).toBe('1');

    const previous = harness.root.querySelector<HTMLButtonElement>(
      '.pagination-controls .page-button:nth-of-type(2)',
    );
    click(previous);
    await flush();
    expect(harness.root.querySelector('.page-current')?.textContent).toBe('1');
    harness.app.dispose();
  });

  it('searches the tasks recursively', async () => {
    const harness = await createHarness(25);
    await selectFolder(harness);

    const search = harness.root.querySelector<HTMLInputElement>('#search-input');
    expect(search).not.toBeNull();
    if (search === null) {
      return;
    }
    search.value = 'marker-7';
    click(buttonByText(harness.doc, 'Search'));
    await flush();

    const rows = harness.root.querySelectorAll('.task-table tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.querySelector('.cell-title')?.textContent).toContain('Task 7');
    expect(harness.root.querySelector('.result-count')?.textContent).toBe(
      '1 result for "marker-7"',
    );

    click(buttonByText(harness.doc, 'Clear'));
    await flush();
    expect(harness.root.querySelectorAll('.task-table tbody tr')).toHaveLength(10);
    harness.app.dispose();
  });

  it('creates, edits and deletes a task', async () => {
    const harness = await createHarness(3);
    await selectFolder(harness);

    // Create
    click(buttonByText(harness.doc, 'New task'));
    await flush();
    const titleInput = harness.doc.querySelector<HTMLInputElement>('#task-title');
    expect(titleInput).not.toBeNull();
    if (titleInput === null) {
      return;
    }
    titleInput.value = 'Brand new task';
    const tagsInput = harness.doc.querySelector<HTMLInputElement>('#task-tags');
    if (tagsInput !== null) {
      tagsInput.value = 'fresh urgent';
    }
    click(buttonByText(harness.doc, 'Create task'));
    await flush();

    const created = harness.bridge.files.get('/home/user/projects/task_4.txt');
    expect(created).toBeDefined();
    expect(created).toContain('title=Brand new task');
    expect(created).toContain('tags=fresh urgent');
    expect(harness.root.querySelectorAll('.task-table tbody tr')).toHaveLength(4);

    // Edit
    const editButtons = harness.root.querySelectorAll<HTMLButtonElement>('.row-action');
    click(editButtons[1]);
    await flush();
    const editTitle = harness.doc.querySelector<HTMLInputElement>('#task-title');
    expect(editTitle?.value).toBe('Task 1');
    if (editTitle === null) {
      return;
    }
    editTitle.value = 'Edited task';
    click(buttonByText(harness.doc, 'Save changes'));
    await flush();

    const edited = harness.bridge.files.get('/home/user/projects/task_1.txt');
    expect(edited).toContain('title=Edited task');
    expect(edited).toContain('id=1');

    // Delete
    const deleteButtons = harness.root.querySelectorAll<HTMLButtonElement>('.row-action');
    click(deleteButtons[3]);
    await flush();
    click(buttonByText(harness.doc, 'Delete'));
    await flush();
    click(buttonByText(harness.doc, 'Yes, delete'));
    await flush();

    expect(harness.bridge.files.has('/home/user/projects/task_1.txt')).toBe(false);
    expect(harness.root.querySelectorAll('.task-table tbody tr')).toHaveLength(3);
    harness.app.dispose();
  });

  it('creates a child task from a parent task', async () => {
    const harness = await createHarness(3);
    await selectFolder(harness);

    // The third action button of a row adds a child task.
    const rowActions = harness.root.querySelectorAll<HTMLButtonElement>('.row-action');
    click(rowActions[2]);
    await flush();

    const banner = harness.doc.querySelector('.task-parent-banner');
    expect(banner?.textContent).toContain('New child of task #1');

    const titleInput = harness.doc.querySelector<HTMLInputElement>('#task-title');
    expect(titleInput).not.toBeNull();
    if (titleInput === null) {
      return;
    }
    titleInput.value = 'A child task';
    click(buttonByText(harness.doc, 'Create task'));
    await flush();

    const created = harness.bridge.files.get('/home/user/projects/task_4.txt');
    expect(created).toBeDefined();
    expect(created).toContain('title=A child task');
    expect(created).toContain('parent=1');

    // The listing shows the parent of the new task.
    const childRow = harness.root.querySelector('tr[data-task-id="4"]');
    expect(childRow?.querySelector('.parent-link')?.textContent).toBe('#1');
    expect(childRow?.classList.contains('task-row-child')).toBe(true);

    // The parent shows the amount of children it has.
    const parentRow = harness.root.querySelector('tr[data-task-id="1"]');
    expect(parentRow?.querySelector('.child-count')?.textContent).toContain('1');
    harness.app.dispose();
  });

  it('lists the children of a task and opens them', async () => {
    const harness = await createHarness(3);
    await selectFolder(harness);

    // The third action button of the first row adds a child task.
    const rowActions = harness.root.querySelectorAll<HTMLButtonElement>('.row-action');
    click(rowActions[2]);
    await flush();
    const titleInput = harness.doc.querySelector<HTMLInputElement>('#task-title');
    if (titleInput === null) {
      return;
    }
    titleInput.value = 'The only child';
    click(buttonByText(harness.doc, 'Create task'));
    await flush();

    // Open the parent task and look at its children.
    const titleButton = harness.root.querySelector<HTMLButtonElement>(
      'tr[data-task-id="1"] .task-title-button',
    );
    click(titleButton);
    await flush();

    const children = harness.doc.querySelectorAll('.child-item');
    expect(children).toHaveLength(1);
    expect(children[0]?.querySelector('.child-id')?.textContent).toBe('#4');
    expect(children[0]?.querySelector('.child-title')?.textContent).toBe('The only child');

    // Clicking the child opens it.
    click(harness.doc.querySelector<HTMLButtonElement>('.child-title'));
    await flush();
    const openedTitle = harness.doc.querySelector('.modal-title')?.textContent;
    expect(openedTitle).toContain('Task #4 - The only child');
    harness.app.dispose();
  });
});

describe('App and the optional token', () => {
  it('never asks for a token when the service does not require one', async () => {
    const harness = await createHarness(0, { token: null, authRequired: false });

    // The button that opens the token dialog is not even shown.
    const tokenButton = buttonByText(harness.doc, 'API token');
    expect(tokenButton?.hasAttribute('hidden')).toBe(true);

    // Choosing a folder opens the picker, not the token dialog.
    click(buttonByText(harness.doc, 'Choose folder…'));
    await flush();
    expect(harness.doc.querySelector('.token-dialog')).toBeNull();
    expect(harness.doc.querySelector('.file-dialog')).not.toBeNull();

    harness.app.dispose();
  });

  it('asks for the token when the service requires one', async () => {
    const harness = await createHarness(0, { token: null, authRequired: true });

    const tokenButton = buttonByText(harness.doc, 'API token');
    expect(tokenButton?.hasAttribute('hidden')).toBe(false);

    click(buttonByText(harness.doc, 'Choose folder…'));
    await flush();
    expect(harness.doc.querySelector('.token-dialog')).not.toBeNull();
    expect(harness.doc.querySelector('.file-dialog')).toBeNull();

    harness.app.dispose();
  });

  it('reads the configuration and lists the tasks without a token', async () => {
    const harness = await createHarness(3, {
      token: null,
      authRequired: false,
      config: JSON.stringify({ projectDir: '/home/user/projects', pageSize: 10 }),
    });

    expect(harness.root.querySelector('.project-path')?.textContent).toBe('/home/user/projects');
    expect(harness.root.querySelectorAll('.task-table tbody tr')).toHaveLength(3);
    expect(harness.root.querySelector('.result-count')?.textContent).toBe('3 tasks');

    harness.app.dispose();
  });

  it('does not ask for a token when a 401 comes from a service that does not need one', async () => {
    const harness = await createHarness(3, {
      token: null,
      authRequired: false,
      config: JSON.stringify({ projectDir: '/home/user/projects', pageSize: 10 }),
      rejectPaths: ['/api/shell'],
    });
    await flush();

    expect(harness.doc.querySelector('.token-dialog')).toBeNull();
    expect(harness.root.querySelector('.service-text')?.textContent).toBe('Service online');
    const toast = harness.doc.querySelector('.toast-error');
    expect(toast?.textContent).toContain('401');

    harness.app.dispose();
  });

  it('notices that the service now demands a token', async () => {
    const harness = await createHarness(0, { token: null, authRequired: false });
    expect(buttonByText(harness.doc, 'API token')?.hasAttribute('hidden')).toBe(true);

    // The service is restarted with the token requirement.
    harness.bridge.authRequired = true;
    await harness.app.start();
    await flush();

    expect(buttonByText(harness.doc, 'API token')?.hasAttribute('hidden')).toBe(false);

    harness.app.dispose();
  });
});

describe('App and the tree view', () => {
  const treeTasks = [
    { id: 1 },
    { id: 2, parentId: 1 },
    { id: 3, parentId: 1 },
    { id: 4, parentId: 2 },
    { id: 5 },
  ];

  async function createTreeHarness(): Promise<Harness> {
    return createHarness(0, {
      tasks: treeTasks,
      config: JSON.stringify({ projectDir: '/home/user/projects', pageSize: 10 }),
    });
  }

  async function switchToTree(harness: Harness): Promise<void> {
    click(buttonByText(harness.doc, 'Tree'));
    await flush();
  }

  function treeRows(harness: Harness): HTMLElement[] {
    return [...harness.root.querySelectorAll<HTMLElement>('.tree-row')];
  }

  function treeRow(harness: Harness, taskId: number): HTMLElement | null {
    return harness.root.querySelector<HTMLElement>(`.tree-row[data-task-id="${taskId}"]`);
  }

  function treeAction(harness: Harness, taskId: number, index: number): HTMLButtonElement | null {
    const row = treeRow(harness, taskId);
    if (row === null) {
      return null;
    }
    return row.querySelectorAll<HTMLButtonElement>('.tree-action')[index] ?? null;
  }

  it('shows the tasks without a parent in the general root', async () => {
    const harness = await createTreeHarness();
    await switchToTree(harness);

    const rows = treeRows(harness);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('.tree-title')?.textContent).toBe('Task 1');
    expect(rows[1]?.querySelector('.tree-title')?.textContent).toBe('Task 5');
    expect(rows[0]?.dataset['depth']).toBe('0');

    // The flat list and its pagination bar are hidden.
    expect(harness.root.querySelector('.table-wrap')?.hasAttribute('hidden')).toBe(true);
    expect(harness.root.querySelector('.pagination-footer')?.hasAttribute('hidden')).toBe(true);
    expect(harness.root.querySelector('.tree-wrap')?.hasAttribute('hidden')).toBe(false);

    harness.app.dispose();
  });

  it('expands and collapses a task', async () => {
    const harness = await createTreeHarness();
    await switchToTree(harness);

    click(harness.root.querySelector<HTMLButtonElement>('.tree-row .tree-twisty'));
    await flush();

    let rows = treeRows(harness);
    expect(rows).toHaveLength(4);
    expect(rows[1]?.querySelector('.tree-title')?.textContent).toBe('Task 2');
    expect(rows[1]?.dataset['depth']).toBe('1');
    expect(rows[2]?.querySelector('.tree-title')?.textContent).toBe('Task 3');

    // The task 2 is expanded as well.
    click(harness.root.querySelectorAll<HTMLButtonElement>('.tree-row .tree-twisty')[1]);
    await flush();
    rows = treeRows(harness);
    expect(rows).toHaveLength(5);
    expect(rows[2]?.querySelector('.tree-title')?.textContent).toBe('Task 4');
    expect(rows[2]?.dataset['depth']).toBe('2');

    // Collapsing the first task hides its children again.
    click(harness.root.querySelector<HTMLButtonElement>('.tree-row .tree-twisty'));
    await flush();
    expect(treeRows(harness)).toHaveLength(2);

    harness.app.dispose();
  });

  it('keeps the state of the children when a task is collapsed with a simple click', async () => {
    const harness = await createTreeHarness();
    await switchToTree(harness);

    // Expand the first task and its first child.
    click(harness.root.querySelector<HTMLButtonElement>('.tree-row .tree-twisty'));
    await flush();
    click(harness.root.querySelectorAll<HTMLButtonElement>('.tree-row .tree-twisty')[1]);
    await flush();
    expect(treeRows(harness)).toHaveLength(5);

    // Collapsing the first task hides its children, but the child stays
    // expanded: expanding the first task again shows them.
    click(harness.root.querySelector<HTMLButtonElement>('.tree-row .tree-twisty'));
    await flush();
    expect(treeRows(harness)).toHaveLength(2);

    click(harness.root.querySelector<HTMLButtonElement>('.tree-row .tree-twisty'));
    await flush();
    const rows = treeRows(harness);
    expect(rows).toHaveLength(5);
    expect(rows[2]?.querySelector('.tree-title')?.textContent).toBe('Task 4');

    harness.app.dispose();
  });

  it('expands the whole branch with a ctrl+click', async () => {
    const harness = await createTreeHarness();
    await switchToTree(harness);

    // Every task of the branch is expanded at once.
    ctrlClick(harness.root.querySelector<HTMLButtonElement>('.tree-row .tree-twisty'), harness.dom);
    await flush();

    const rows = treeRows(harness);
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.querySelector('.tree-title')?.textContent)).toEqual([
      'Task 1',
      'Task 2',
      'Task 4',
      'Task 3',
      'Task 5',
    ]);

    harness.app.dispose();
  });

  it('collapses the whole branch with a ctrl+click', async () => {
    const harness = await createTreeHarness();
    await switchToTree(harness);

    // Expand the first task and its first child.
    click(harness.root.querySelector<HTMLButtonElement>('.tree-row .tree-twisty'));
    await flush();
    click(harness.root.querySelectorAll<HTMLButtonElement>('.tree-row .tree-twisty')[1]);
    await flush();
    expect(treeRows(harness)).toHaveLength(5);

    // The ctrl+click collapses the task and all its descendants.
    ctrlClick(harness.root.querySelector<HTMLButtonElement>('.tree-row .tree-twisty'), harness.dom);
    await flush();
    expect(treeRows(harness)).toHaveLength(2);

    // Expanding it again with a ctrl+click brings the whole branch back.
    ctrlClick(harness.root.querySelector<HTMLButtonElement>('.tree-row .tree-twisty'), harness.dom);
    await flush();
    expect(treeRows(harness)).toHaveLength(5);

    harness.app.dispose();
  });

  it('focuses a task so that it becomes the root of the tree', async () => {
    const harness = await createTreeHarness();
    await switchToTree(harness);

    // The first action of a row focuses the tree on the task.
    click(treeAction(harness, 1, 0));
    await flush();

    // The focused task is the root of the displayed tree: the other tasks
    // without a parent are gone.
    const rows = treeRows(harness);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.querySelector('.tree-title')?.textContent).toBe('Task 1');
    expect(rows[1]?.dataset['depth']).toBe('1');

    const crumbs = [...harness.root.querySelectorAll('.tree-crumb')];
    expect(crumbs[0]?.textContent).toBe('General root');
    expect(crumbs[1]?.textContent).toBe('Task 1');

    harness.app.dispose();
  });

  it('focuses a child task and hides the tasks outside of its hierarchy', async () => {
    const harness = await createTreeHarness();
    await switchToTree(harness);

    // Expand the first task, then focus its first child.
    click(harness.root.querySelector<HTMLButtonElement>('.tree-row .tree-twisty'));
    await flush();
    click(treeAction(harness, 2, 0));
    await flush();

    const rows = treeRows(harness);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('.tree-title')?.textContent).toBe('Task 2');
    expect(rows[1]?.querySelector('.tree-title')?.textContent).toBe('Task 4');

    // The breadcrumb shows the ancestors of the focused task.
    const crumbs = [...harness.root.querySelectorAll('.tree-crumb')];
    expect(crumbs.map((crumb) => crumb.textContent)).toEqual(['General root', '#1', 'Task 2']);

    harness.app.dispose();
  });

  it('moves a task under another one when it is dropped on it', async () => {
    const harness = await createTreeHarness();
    await switchToTree(harness);

    // The task 4 is a child of the task 2: the branch is expanded so that it
    // can be dragged.
    click(harness.root.querySelector<HTMLButtonElement>('.tree-row .tree-twisty'));
    await flush();
    click(harness.root.querySelectorAll<HTMLButtonElement>('.tree-row .tree-twisty')[1]);
    await flush();
    expect(treeRow(harness, 4)).not.toBeNull();

    // The task 4 is dropped on the task 3.
    dragTask(harness, 4, 3);
    await flush();

    // The file on the disk carries the new parent.
    const file = harness.bridge.files.get('/home/user/projects/task_4.txt');
    expect(file).toContain('parent=3');
    expect(file).not.toContain('parent=2');

    // The tree shows the task 4 under the task 3.
    click(treeRow(harness, 3)?.querySelector<HTMLButtonElement>('.tree-twisty') ?? null);
    await flush();
    expect(treeRow(harness, 4)?.dataset['depth']).toBe('2');
    expect(treeRow(harness, 4)?.querySelector('.tree-title')?.textContent).toBe('Task 4');

    harness.app.dispose();
  });

  it('refuses to move a task under one of its own descendants', async () => {
    const harness = await createTreeHarness();
    await switchToTree(harness);

    // The task 4 is a child of the task 2: the branch is expanded so that it
    // can be used as a drop target.
    click(harness.root.querySelector<HTMLButtonElement>('.tree-row .tree-twisty'));
    await flush();
    click(harness.root.querySelectorAll<HTMLButtonElement>('.tree-row .tree-twisty')[1]);
    await flush();

    // The task 2 is the parent of the task 4: it cannot become its child.
    dragTask(harness, 2, 4);
    await flush();

    const file = harness.bridge.files.get('/home/user/projects/task_2.txt');
    expect(file).not.toContain('parent=4');
    const toast = harness.doc.querySelector('.toast-error');
    expect(toast?.textContent).toContain('descendant');

    harness.app.dispose();
  });

  it('goes back to the general root', async () => {
    const harness = await createTreeHarness();
    await switchToTree(harness);

    click(treeAction(harness, 1, 0));
    await flush();
    expect(treeRows(harness)).toHaveLength(3);
    expect(treeRow(harness, 5)).toBeNull();

    click(harness.root.querySelector<HTMLButtonElement>('.tree-crumb'));
    await flush();
    expect(treeRow(harness, 5)).not.toBeNull();

    harness.app.dispose();
  });

  it('opens the view and the edit dialogs of a task of the tree', async () => {
    const harness = await createTreeHarness();
    await switchToTree(harness);

    // The name of the task opens the read only view.
    click(harness.root.querySelector<HTMLButtonElement>('.tree-title'));
    await flush();
    expect(harness.doc.querySelector('.modal-title')?.textContent).toContain('Task #1 - Task 1');
    click(buttonByText(harness.doc, 'Close'));
    await flush();

    // The pencil opens the editor.
    click(treeAction(harness, 1, 2));
    await flush();
    const title = harness.doc.querySelector<HTMLInputElement>('#task-title');
    expect(title?.value).toBe('Task 1');

    harness.app.dispose();
  });

  it('searches in the tree and keeps the ancestors of the matches', async () => {
    const harness = await createTreeHarness();
    await switchToTree(harness);

    const search = harness.root.querySelector<HTMLInputElement>('#search-input');
    expect(search).not.toBeNull();
    if (search === null) {
      return;
    }
    search.value = 'marker-4';
    click(buttonByText(harness.doc, 'Search'));
    await flush();

    const rows = treeRows(harness);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.querySelector('.tree-title')?.textContent)).toEqual([
      'Task 1',
      'Task 2',
      'Task 4',
    ]);

    harness.app.dispose();
  });

  it('goes back to the flat list', async () => {
    const harness = await createTreeHarness();
    await switchToTree(harness);
    expect(harness.root.querySelector('.tree-wrap')?.hasAttribute('hidden')).toBe(false);

    click(buttonByText(harness.doc, 'List'));
    await flush();

    expect(harness.root.querySelector('.tree-wrap')?.hasAttribute('hidden')).toBe(true);
    expect(harness.root.querySelector('.table-wrap')?.hasAttribute('hidden')).toBe(false);
    expect(harness.root.querySelectorAll('.task-table tbody tr')).toHaveLength(5);

    harness.app.dispose();
  });
});

async function selectFolder(harness: Harness): Promise<void> {
  click(buttonByText(harness.doc, 'Choose folder…'));
  await flush();

  const entry = [...harness.doc.querySelectorAll('.fd-entry')].find((node) =>
    node.querySelector('.fd-entry-name')?.textContent === 'projects',
  );
  doubleClick(entry, harness.dom);
  await flush();

  click(buttonByText(harness.doc, 'Use this folder'));
  await flush();
}
