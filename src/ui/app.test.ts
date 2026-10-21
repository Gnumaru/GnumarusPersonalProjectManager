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

function taskContent(id: number): string {
  return [
    `id=${id}`,
    `title=Task ${id}`,
    'status=todo',
    `tags=tag${id}`,
    'created=2026-10-01T10:00:00.000Z',
    'updated=2026-10-02T10:00:00.000Z',
    '----',
    `marker-${id}`,
  ].join('\n');
}

async function createHarness(taskCount = 25): Promise<Harness> {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const doc = dom.window.document;
  const root = doc.createElement('div');
  doc.body.append(root);

  const bridge = new FakeBridge({ token: 'test-token' });
  bridge.directories.add('/home/user');
  bridge.directories.add('/home/user/projects');
  for (let id = 1; id <= taskCount; id += 1) {
    bridge.addFile(`/home/user/projects/task_${id}.txt`, taskContent(id));
  }

  const api = new ApiClient({ baseUrl: bridge.baseUrl, token: 'test-token', fetchImpl: bridge.fetch });
  const storage = new MemoryStorage();
  storage.setItem('gnumarus-project-manager.token', 'test-token');

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
    click(deleteButtons[2]);
    await flush();
    click(buttonByText(harness.doc, 'Delete'));
    await flush();
    click(buttonByText(harness.doc, 'Yes, delete'));
    await flush();

    expect(harness.bridge.files.has('/home/user/projects/task_1.txt')).toBe(false);
    expect(harness.root.querySelectorAll('.task-table tbody tr')).toHaveLength(3);
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
