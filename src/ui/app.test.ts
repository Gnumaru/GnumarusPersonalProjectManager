import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vite-plus/test';
import { ApiClient } from '../api/client.js';
import { FakeBridge } from '../test-support/fakeBridge.js';
import { fakeDirectoryHandle } from '../test-support/fakeDirectory.js';
import { createDirectoryHandleStorage, type DirectoryHandleStorage } from '../core/fileSystemAccess.js';
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
  /** Where the handle of the folder of the project is kept. */
  readonly handleStorage: DirectoryHandleStorage;
  /** The root of the Origin Private File System. */
  readonly opfs: FileSystemDirectoryHandle;
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
  readonly tasks?: readonly {
    readonly id: number;
    readonly parentId?: number;
    readonly expanded?: boolean;
    readonly updated?: string;
  }[];
  /** The notes created on the fake disk. */
  readonly notes?: readonly {
    readonly id: number;
    readonly title?: string;
    readonly content?: string;
    readonly updated?: string;
  }[];
  /**
   * The kind of storage the project uses.
   *
   * `default` means that nothing is stored: the browser chooses, as it does
   * when the user opens the application for the first time.
   */
  readonly mode?: 'service' | 'embedded' | 'filesystem' | 'default';
  /** True when the browser offers the File System Access API (default: `true`). */
  readonly fileSystemAvailable?: boolean;
  /**
   * False when the application knows nothing about the folder of the project.
   *
   * The user is then asked to choose it with the picker of the browser.
   */
  readonly folderKnown?: boolean;
}

function taskContent(
  id: number,
  parentId: number | null = null,
  expanded = false,
  updated = '20261002100000000',
): string {
  const lines = [`id=${id}`, `title=Task ${id}`, 'status=todo'];
  if (parentId !== null) {
    lines.push(`parent=${parentId}`);
  }
  lines.push(
    `updated=${updated}`,
    `tags=tag${id}`,
    'created=20261001100000000',
    'start=',
    'end=',
  );
  if (expanded) {
    lines.push('expanded=true');
  }
  lines.push('----', `marker-${id}`);
  return lines.join('\n');
}

function noteContent(id: number, title = `Note ${id}`, content = `body-${id}`, updated = '20261002100000000'): string {
  return [
    `id=${id}`,
    `title=${title}`,
    'created=20261001100000000',
    `updated=${updated}`,
    '----',
    content,
  ].join('\n');
}

export async function createHarness(taskCount = 25, options: HarnessOptions = {}): Promise<Harness> {
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
        taskContent(task.id, task.parentId ?? null, task.expanded ?? false, task.updated),
      );
    }
  } else {
    for (let id = 1; id <= taskCount; id += 1) {
      bridge.addFile(`/home/user/projects/task_${id}.txt`, taskContent(id));
    }
  }
  for (const note of options.notes ?? []) {
    bridge.addFile(
      `/home/user/projects/note_${note.id}.txt`,
      noteContent(note.id, note.title ?? undefined, note.content ?? undefined, note.updated),
    );
  }
  if (options.config !== undefined) {
    bridge.addFile('~/.config/GnumarusProjectManager/config.json', options.config);
  }

  const api = new ApiClient({ baseUrl: bridge.baseUrl, token, fetchImpl: bridge.fetch });
  const storage = new MemoryStorage();
  if (token !== null) {
    storage.setItem('gnumarus-project-manager.token', token);
  }
  // The tests work on the project of the service, unless they ask for
  // another storage.
  const mode = options.mode ?? 'service';
  if (mode !== 'default') {
    storage.setItem('gnumarus-project-manager.mode', mode);
  }

  // The folder of the project, with the files of the project.
  const handleStorage = createDirectoryHandleStorage();
  const directory = fakeDirectoryHandle('project');
  const fake = directory as unknown as { addFile: (path: string, content: string) => void };
  for (let id = 1; id <= taskCount; id += 1) {
    fake.addFile(`task_${id}.txt`, taskContent(id));
  }
  for (const note of options.notes ?? []) {
    fake.addFile(
      `note_${note.id}.txt`,
      noteContent(note.id, note.title ?? undefined, note.content ?? undefined, note.updated),
    );
  }

  // The browser offers the Origin Private File System: the files of the
  // embedded project live at its root.
  const opfsRoot = fakeDirectoryHandle('opfs');
  const opfs = opfsRoot as unknown as { addFile: (path: string, content: string) => void };
  for (let id = 1; id <= taskCount; id += 1) {
    opfs.addFile(`task_${id}.txt`, taskContent(id));
  }
  for (const note of options.notes ?? []) {
    opfs.addFile(
      `note_${note.id}.txt`,
      noteContent(note.id, note.title ?? undefined, note.content ?? undefined, note.updated),
    );
  }
  Object.defineProperty(dom.window.navigator, 'storage', {
    configurable: true,
    value: {
      getDirectory: async (): Promise<FileSystemDirectoryHandle> => opfsRoot,
    },
  });

  // The browser offers the File System Access API.
  const fileSystemAvailable = options.fileSystemAvailable !== false;
  if (fileSystemAvailable) {
    const win = dom.window as unknown as {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    };
    win.showDirectoryPicker = async (): Promise<FileSystemDirectoryHandle> => directory;
  }

  if (options.mode === 'filesystem' && options.folderKnown !== false) {
    await handleStorage.write(directory);
  }

  const app = new App({ doc, root, api, storage, handleStorage });
  await app.start();

  return { app, bridge, doc, root, dom, handleStorage, opfs: opfsRoot };
}

export async function flush(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export function click(element: Element | null | undefined): void {
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

/** Drags a card of the board onto a column, as the mouse would do. */
function dragCard(harness: Harness, taskId: number, status: string): void {
  const source = harness.root.querySelector<HTMLElement>(
    `.kanban-card[data-task-id="${taskId}"] .kanban-card-title`,
  );
  const target = harness.root.querySelector<HTMLElement>(`.kanban-column[data-status="${status}"]`);
  if (source === null || target === null) {
    return;
  }
  const event = (type: string, node: Element, x: number, y: number): void => {
    node.dispatchEvent(
      new harness.dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }),
    );
  };
  event('mousedown', source, 10, 10);
  event('mousemove', target, 60, 60);
  event('mouseup', target, 60, 60);
}

/** Drags a row of the tree onto another one, as the mouse would do. */
function dragTask(harness: Harness, draggedId: number, targetId: number): void {
  const target = harness.root.querySelector<HTMLElement>(`.tree-row[data-task-id="${targetId}"]`);
  dragTaskTo(harness, draggedId, target);
}

/** Drags a row of the tree onto the given element, as the mouse would do. */
function dragTaskTo(harness: Harness, draggedId: number, target: Element | null): void {
  const source = harness.root.querySelector<HTMLElement>(
    `.tree-row[data-task-id="${draggedId}"] .tree-title`,
  );
  if (source === null || target === null) {
    return;
  }
  const event = (type: string, node: Element, x: number, y: number): void => {
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

  it('edits the start and the end dates of a task', async () => {
    const harness = await createHarness(3);
    await selectFolder(harness);

    // Open the editor of the first task.
    const editButtons = harness.root.querySelectorAll<HTMLButtonElement>('.row-action');
    click(editButtons[1]);
    await flush();

    // The editor holds a date picker for the start and for the end.
    const startInput = harness.doc.querySelector<HTMLInputElement>('#task-start');
    const endInput = harness.doc.querySelector<HTMLInputElement>('#task-end');
    expect(startInput).not.toBeNull();
    expect(endInput).not.toBeNull();
    expect(startInput?.getAttribute('type')).toBe('date');
    expect(endInput?.getAttribute('type')).toBe('date');
    if (startInput === null || endInput === null) {
      return;
    }

    startInput.value = '2026-10-19';
    endInput.value = '2026-10-23';
    click(buttonByText(harness.doc, 'Save changes'));
    await flush();

    // The dates are written in the compact format.
    const edited = harness.bridge.files.get('/home/user/projects/task_1.txt');
    expect(edited).toContain('start=20261019000000000');
    expect(edited).toContain('end=20261023000000000');
  });

  it('refuses a date range that ends before it starts', async () => {
    const harness = await createHarness(3);
    await selectFolder(harness);

    const editButtons = harness.root.querySelectorAll<HTMLButtonElement>('.row-action');
    click(editButtons[1]);
    await flush();

    const startInput = harness.doc.querySelector<HTMLInputElement>('#task-start');
    const endInput = harness.doc.querySelector<HTMLInputElement>('#task-end');
    if (startInput === null || endInput === null) {
      return;
    }
    startInput.value = '2026-10-19';
    endInput.value = '2026-10-12';
    click(buttonByText(harness.doc, 'Save changes'));
    await flush();

    const error = harness.doc.querySelector('.form-error');
    expect(error?.textContent).toContain('end date');
    // The file was not written: it keeps the dates that were assigned on the
    // load (the day of today and the day of tomorrow).
    const file = harness.bridge.files.get('/home/user/projects/task_1.txt');
    expect(file).not.toContain('start=20261019');
    expect(file).not.toContain('end=20261012');
  });

  it('adds the tasks that block a task and the tasks that are related to it', async () => {
    const harness = await createHarness(3);
    await selectFolder(harness);

    const editButtons = harness.root.querySelectorAll<HTMLButtonElement>('.row-action');
    click(editButtons[1]);
    await flush();

    // The editor holds a field for the blocking tasks and one for the related
    // ones.
    const fields = [...harness.doc.querySelectorAll('.id-list')];
    expect(fields).toHaveLength(2);

    const addTask = async (field: Element, title: string): Promise<void> => {
      const input = field.querySelector<HTMLInputElement>('.id-list-input');
      if (input === null) {
        return;
      }
      input.value = title;
      input.dispatchEvent(new harness.dom.window.Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 360));
      input.dispatchEvent(
        new harness.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
      await flush();
    };

    await addTask(fields[0] as Element, 'Task 3');
    await addTask(fields[1] as Element, 'Task 2');

    const chips = [...harness.doc.querySelectorAll('.id-chip-label')].map(
      (chip) => chip.textContent,
    );
    expect(chips).toEqual(['#3 Task 3', '#2 Task 2']);

    click(buttonByText(harness.doc, 'Save changes'));
    await flush();

    // The relations are written in the file of the task.
    const file = harness.bridge.files.get('/home/user/projects/task_1.txt');
    expect(file).toContain('blocked_by=3');
    expect(file).toContain('related=2');
  });

  it('refuses to add the task itself as a blocker or as a related task', async () => {
    const harness = await createHarness(3);
    await selectFolder(harness);

    const editButtons = harness.root.querySelectorAll<HTMLButtonElement>('.row-action');
    click(editButtons[1]);
    await flush();

    const field = harness.doc.querySelector('.id-list');
    const input = field?.querySelector<HTMLInputElement>('.id-list-input');
    if (input === null || input === undefined) {
      return;
    }
    input.value = 'Task 1';
    input.dispatchEvent(new harness.dom.window.Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 360));
    input.dispatchEvent(
      new harness.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    await flush();

    expect(harness.doc.querySelectorAll('.id-chip-label')).toHaveLength(0);
  });

  it('writes, edits and deletes the comments of a task', async () => {
    const harness = await createHarness(3);
    await selectFolder(harness);

    const editButtons = harness.root.querySelectorAll<HTMLButtonElement>('.row-action');
    click(editButtons[1]);
    await flush();

    // The editor shows the comments of the task.
    expect(harness.doc.querySelector('.task-comments')).not.toBeNull();
    expect(harness.doc.querySelector('.task-comments-empty')).not.toBeNull();

    // A new comment is written in its own file.
    const newComment = harness.doc.querySelector<HTMLTextAreaElement>('.task-comment-new');
    expect(newComment).not.toBeNull();
    if (newComment === null) {
      return;
    }
    newComment.value = 'The first comment';
    click(buttonByText(harness.doc, 'Add comment'));
    await flush();

    const commentFile = harness.bridge.files.get('/home/user/projects/comment_1.txt');
    expect(commentFile).toContain('id=1');
    expect(commentFile).toContain('task=1');
    expect(commentFile).toContain('The first comment');

    // The comment shows up in the list.
    const comments = [...harness.doc.querySelectorAll('.task-comment')];
    expect(comments).toHaveLength(1);
    expect(comments[0]?.querySelector('.task-comment-text')?.textContent).toBe('The first comment');

    // The comment is edited.
    click(buttonByText(harness.doc, 'Edit'));
    await flush();
    const editor = harness.doc.querySelector<HTMLTextAreaElement>('.task-comment-editor');
    expect(editor).not.toBeNull();
    if (editor === null) {
      return;
    }
    editor.value = 'The edited comment';
    click(buttonByText(harness.doc, 'Save'));
    await flush();

    const editedFile = harness.bridge.files.get('/home/user/projects/comment_1.txt');
    expect(editedFile).toContain('The edited comment');
    expect(
      harness.doc.querySelector('.task-comment-text')?.textContent,
    ).toBe('The edited comment');

    // The comment is deleted.
    click(buttonByText(harness.doc, 'Delete'));
    await flush();

    expect(harness.bridge.files.has('/home/user/projects/comment_1.txt')).toBe(false);
    expect(harness.doc.querySelectorAll('.task-comment')).toHaveLength(0);

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

  it('prefills the dates of a new task with today and tomorrow', async () => {
    const harness = await createHarness(3);
    await selectFolder(harness);

    click(buttonByText(harness.doc, 'New task'));
    await flush();

    const startInput = harness.doc.querySelector<HTMLInputElement>('#task-start');
    const endInput = harness.doc.querySelector<HTMLInputElement>('#task-end');
    expect(startInput).not.toBeNull();
    expect(endInput).not.toBeNull();
    if (startInput === null || endInput === null) {
      return;
    }

    // The default range of a new task: one day, today until tomorrow.
    const opened = new Date();
    const tomorrow = new Date(opened);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const two = (value: number): string => String(value).padStart(2, '0');
    const pickerValue = (date: Date): string =>
      `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
    const midnightValue = (date: Date): string =>
      `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}000000000`;

    // The dialog opens with today as the start and tomorrow as the end.
    expect(startInput.value).toBe(pickerValue(opened));
    expect(endInput.value).toBe(pickerValue(tomorrow));

    // The user only names the task: the default dates are saved as they are.
    const titleInput = harness.doc.querySelector<HTMLInputElement>('#task-title');
    if (titleInput === null) {
      return;
    }
    titleInput.value = 'Dated task';
    click(buttonByText(harness.doc, 'Create task'));
    await flush();

    const created = harness.bridge.files.get('/home/user/projects/task_4.txt');
    expect(created).toContain('title=Dated task');
    expect(created).toContain(`start=${midnightValue(opened)}`);
    expect(created).toContain(`end=${midnightValue(tomorrow)}`);
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

describe('Sorting of the task list and of the notes list', () => {
  it('sorts by ID descending at the first click and inverts on the next one', async () => {
    const harness = await createHarness(25);
    await selectFolder(harness);

    const idHeader = harness.root.querySelector<HTMLButtonElement>(
      '.task-table thead .cell-id .th-sort',
    );
    expect(idHeader?.textContent).toBe('ID ↕');
    click(idHeader);
    await flush();
    expect(
      [...harness.root.querySelectorAll('.task-table tbody tr td.cell-id')].slice(0, 2).map(
        (cell) => cell.textContent,
      ),
    ).toEqual(['25', '24']);
    expect(harness.root.querySelector('.task-table thead .cell-id .th-sort')?.textContent).toBe(
      'ID ▼',
    );

    click(harness.root.querySelector('.task-table thead .cell-id .th-sort'));
    await flush();
    expect(
      [...harness.root.querySelectorAll('.task-table tbody tr td.cell-id')].slice(0, 2).map(
        (cell) => cell.textContent,
      ),
    ).toEqual(['1', '2']);
    expect(harness.root.querySelector('.task-table thead .cell-id .th-sort')?.textContent).toBe(
      'ID ▲',
    );
    harness.app.dispose();
  });

  it('sorts by title, alphabetically', async () => {
    const harness = await createHarness(25);
    await selectFolder(harness);

    click(harness.root.querySelector('.task-table thead .cell-title .th-sort'));
    await flush();
    // The numbers inside the titles are compared as numbers: Task 25 sorts
    // before Task 9 when descending.
    expect(
      [...harness.root.querySelectorAll('.task-table tbody tr td.cell-title .task-title-button')]
        .slice(0, 1)
        .map((cell) => cell.textContent),
    ).toEqual(['Task 25']);
    harness.app.dispose();
  });

  it('sorts by the updated timestamp by date', async () => {
    const harness = await createHarness(0, {
      tasks: [
        { id: 1, updated: '20261001100000000' },
        { id: 2, updated: '20261005120000000' },
        { id: 3, updated: '20261003080000000' },
        { id: 4, updated: '20261002090000000' },
      ],
    });
    await selectFolder(harness);

    click(harness.root.querySelector('.task-table thead .cell-updated .th-sort'));
    await flush();
    expect(
      [...harness.root.querySelectorAll('.task-table tbody tr td.cell-id')].map(
        (cell) => cell.textContent,
      ),
    ).toEqual(['2', '3', '4', '1']);
    harness.app.dispose();
  });

  it('sorts by parent, the tasks without a parent first', async () => {
    const harness = await createHarness(0, {
      tasks: [
        { id: 1, parentId: 5 },
        { id: 2 },
        { id: 3, parentId: 2 },
        { id: 4 },
      ],
    });
    await selectFolder(harness);

    click(harness.root.querySelector('.task-table thead .cell-parent .th-sort'));
    await flush();
    // Descending: the tasks without a parent come first, then the larger
    // parent before the smaller one.
    expect(
      [...harness.root.querySelectorAll('.task-table tbody tr td.cell-id')].map(
        (cell) => cell.textContent,
      ),
    ).toEqual(['2', '4', '1', '3']);
    harness.app.dispose();
  });

  it('makes the tags and the actions columns not sortable', async () => {
    const harness = await createHarness(3);
    await selectFolder(harness);

    expect(harness.root.querySelector('.task-table thead .cell-tags .th-sort')).toBeNull();
    expect(harness.root.querySelector('.task-table thead .cell-actions .th-sort')).toBeNull();
    harness.app.dispose();
  });

  it('goes back to the first page when the sort changes', async () => {
    const harness = await createHarness(25);
    await selectFolder(harness);

    click(harness.root.querySelector<HTMLButtonElement>('.page-last'));
    await flush();
    expect(harness.root.querySelector('.page-current')?.textContent).toBe('3');

    click(harness.root.querySelector('.task-table thead .cell-id .th-sort'));
    await flush();
    expect(harness.root.querySelector('.page-current')?.textContent).toBe('1');
    expect(harness.root.querySelectorAll('.task-table tbody tr td.cell-id')[0]?.textContent).toBe(
      '25',
    );
    harness.app.dispose();
  });

  it('sorts the notes by title and by updated', async () => {
    const harness = await createHarness(0, {
      tasks: [
        { id: 1, updated: '20261001100000000' },
        { id: 2, updated: '20261005120000000' },
        { id: 3, updated: '20261003080000000' },
      ],
      notes: [
        { id: 1, title: 'banana', updated: '20261001100000000' },
        { id: 2, title: 'apple', updated: '20261005120000000' },
        { id: 3, title: 'cherry', updated: '20261003080000000' },
      ],
    });
    await selectFolder(harness);

    click(buttonByText(harness.doc, 'Notes'));
    await flush();

    click(harness.root.querySelector('.note-table thead .cell-title .th-sort'));
    await flush();
    expect(
      [...harness.root.querySelectorAll('.note-table tbody tr td.cell-title .task-title-button')].map(
        (cell) => cell.textContent,
      ),
    ).toEqual(['cherry', 'banana', 'apple']);

    click(harness.root.querySelector('.note-table thead .cell-updated .th-sort'));
    await flush();
    expect(
      [...harness.root.querySelectorAll('.note-table tbody tr td.cell-id')].map(
        (cell) => cell.textContent,
      ),
    ).toEqual(['2', '3', '1']);

    // The other views keep their own order.
    click(buttonByText(harness.doc, 'List'));
    await flush();
    console.log('LIST-BUTTON', buttonByText(harness.doc, 'List')?.outerHTML?.slice(0, 80));
    console.log('VIEW-TABLES', [...harness.root.querySelectorAll('table')].map((t) => t.className), harness.root.querySelector('.task-table tbody')?.innerHTML.slice(0, 200));
    expect(
      [...harness.root.querySelectorAll('.task-table tbody tr td.cell-id')].map(
        (cell) => cell.textContent,
      ),
    ).toEqual(['1', '2', '3']);
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

  it('persists the expanded state in the file of the task', async () => {
    const harness = await createTreeHarness();
    await switchToTree(harness);

    // The branch is expanded: the file of the task carries the key.
    click(harness.root.querySelector<HTMLButtonElement>('.tree-row[data-task-id="1"] .tree-twisty'));
    await flush();
    let file = harness.bridge.files.get('/home/user/projects/task_1.txt');
    expect(file).toContain('expanded=true');
    // The key is a view preference: the content of the task is untouched.
    expect(file).toContain('updated=20261002100000000');
    expect(file).toContain('marker-1');

    // Collapsed again: the key is simply removed.
    click(harness.root.querySelector<HTMLButtonElement>('.tree-row[data-task-id="1"] .tree-twisty'));
    await flush();
    file = harness.bridge.files.get('/home/user/projects/task_1.txt');
    expect(file).not.toContain('expanded=');
    harness.app.dispose();
  });

  it('persists the state of the whole branch on a ctrl+click', async () => {
    const harness = await createTreeHarness();
    await switchToTree(harness);

    const row = harness.root.querySelector<HTMLElement>('.tree-row[data-task-id="1"]');
    ctrlClick(row?.querySelector<HTMLButtonElement>('.tree-twisty'), harness.dom);
    await flush();

    // Every task of the branch is expanded on the disk.
    for (const id of [1, 2, 3, 4]) {
      expect(harness.bridge.files.get(`/home/user/projects/task_${id}.txt`)).toContain('expanded=true');
    }
    // The tasks outside of the branch are untouched.
    expect(harness.bridge.files.get('/home/user/projects/task_5.txt')).not.toContain('expanded=');
    harness.app.dispose();
  });

  it('assigns the missing dates of the tasks when they are loaded', async () => {
    const harness = await createHarness(0, {
      tasks: [
        { id: 1 },
        { id: 2, parentId: 1 },
      ],
      config: JSON.stringify({ projectDir: '/home/user/projects', pageSize: 10 }),
    });

    // The dates are assigned on the disk: today for the start, tomorrow for
    // the end, at midnight, and the update time of the file is untouched.
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const midnight = (date: Date): string => {
      const copy = new Date(date);
      copy.setHours(0, 0, 0, 0);
      return [
        String(copy.getFullYear()).padStart(4, '0'),
        String(copy.getMonth() + 1).padStart(2, '0'),
        String(copy.getDate()).padStart(2, '0'),
        '000000000',
      ].join('');
    };
    const file = harness.bridge.files.get('/home/user/projects/task_1.txt');
    expect(file).toContain(`start=${midnight(today)}`);
    expect(file).toContain(`end=${midnight(tomorrow)}`);
    expect(file).toContain('updated=20261002100000000');

    // The view shows the assigned dates without another refresh.
    const rows = [...harness.root.querySelectorAll<HTMLElement>('.task-table tbody tr')];
    expect(rows).toHaveLength(2);

    harness.app.dispose();
  });

  it('restores the expanded state of the files when the app opens', async () => {
    const harness = await createHarness(0, {
      tasks: [
        { id: 1, expanded: true },
        { id: 2, parentId: 1, expanded: true },
        { id: 3, parentId: 1 },
        { id: 4, parentId: 2 },
        { id: 5 },
      ],
      config: JSON.stringify({ projectDir: '/home/user/projects', pageSize: 10 }),
    });
    await switchToTree(harness);

    // The branches whose files carry `expanded=true` are open: the task 4 has
    // to be on the screen, three levels deep, without any click.
    const rows = treeRows(harness);
    expect(rows).toHaveLength(5);
    expect(rows[1]?.dataset['depth']).toBe('1');
    expect(harness.root.querySelector<HTMLElement>('.tree-row[data-task-id="4"]')?.dataset['depth']).toBe('2');
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

  it('expands the parent of a newly added child task', async () => {
    const harness = await createTreeHarness();
    await switchToTree(harness);

    // The task 1 has children and is collapsed from the start. It is expanded
    // and collapsed again, so the collapse is in place when the child is
    // added. The other root task (the task 5) stays on the screen.
    click(harness.root.querySelector<HTMLButtonElement>('.tree-row[data-task-id="1"] .tree-twisty'));
    await flush();
    expect(treeRows(harness)).toHaveLength(4);
    click(harness.root.querySelector<HTMLButtonElement>('.tree-row[data-task-id="1"] .tree-twisty'));
    await flush();
    expect(treeRows(harness)).toHaveLength(2);

    // A child is added through the actions of the row.
    click(treeAction(harness, 1, 5));
    await flush();
    const titleInput = harness.doc.querySelector<HTMLInputElement>('#task-title');
    expect(titleInput).not.toBeNull();
    if (titleInput === null) {
      return;
    }
    titleInput.value = 'The new child';
    click(buttonByText(harness.doc, 'Create task'));
    await flush();

    // The parent was collapsed: its new child is shown anyway. (The task 5,
    // the other root task, comes after the children.)
    const rows = treeRows(harness);
    expect(rows).toHaveLength(5);
    expect(rows[3]?.querySelector('.tree-title')?.textContent).toBe('The new child');
    expect(rows[3]?.dataset['depth']).toBe('1');
    expect(
      harness.root
        .querySelector<HTMLButtonElement>('.tree-row[data-task-id="1"] .tree-twisty')
        ?.classList.contains('is-expanded'),
    ).toBe(true);
    expect(harness.bridge.files.has('/home/user/projects/task_6.txt')).toBe(true);
    harness.app.dispose();
  });

  it('expands a parent that had no child when its first child is added', async () => {
    const harness = await createTreeHarness();
    await switchToTree(harness);

    // A new root task is created: it has no child yet.
    click(buttonByText(harness.doc, 'New task'));
    await flush();
    const titleInput = harness.doc.querySelector<HTMLInputElement>('#task-title');
    expect(titleInput).not.toBeNull();
    if (titleInput === null) {
      return;
    }
    titleInput.value = 'The fresh parent';
    click(buttonByText(harness.doc, 'Create task'));
    await flush();

    // A task without a child cannot be expanded.
    expect(
      treeRow(harness, 6)?.querySelector<HTMLButtonElement>('.tree-twisty')?.disabled,
    ).toBe(true);

    // Its first child is added: the branch opens by itself and shows it.
    click(treeAction(harness, 6, 5));
    await flush();
    const childInput = harness.doc.querySelector<HTMLInputElement>('#task-title');
    expect(childInput).not.toBeNull();
    if (childInput === null) {
      return;
    }
    childInput.value = 'Its first child';
    click(buttonByText(harness.doc, 'Create task'));
    await flush();

    const rows = treeRows(harness);
    expect(rows).toHaveLength(4);
    expect(rows[2]?.querySelector('.tree-title')?.textContent).toBe('The fresh parent');
    expect(rows[3]?.querySelector('.tree-title')?.textContent).toBe('Its first child');
    expect(rows[3]?.dataset['depth']).toBe('1');
    expect(
      treeRow(harness, 6)?.querySelector<HTMLButtonElement>('.tree-twisty')?.classList.contains('is-expanded'),
    ).toBe(true);
    harness.app.dispose();
  });

  it('focuses a task so that it becomes the root of the tree', async () => {
    const harness = await createTreeHarness();
    await switchToTree(harness);

    // The first action of a row focuses the tree on the task.
    click(treeAction(harness, 1, 2));
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
    click(treeAction(harness, 2, 2));
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

    // The tree shows the task 4 under the task 3: dropping a child on the task
    // opens the branch of the new parent by itself.
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

  it('makes a task a root task when it is dropped on the general root', async () => {
    const harness = await createTreeHarness();
    await switchToTree(harness);

    // The branch is expanded so that the task 4 can be dragged.
    click(harness.root.querySelector<HTMLButtonElement>('.tree-row .tree-twisty'));
    await flush();
    click(harness.root.querySelectorAll<HTMLButtonElement>('.tree-row .tree-twisty')[1]);
    await flush();

    // The task 4 is dropped on the general root.
    dragTaskTo(harness, 4, harness.root.querySelector('.tree-root-target'));
    await flush();

    // The file does not carry a parent any more.
    const file = harness.bridge.files.get('/home/user/projects/task_4.txt');
    expect(file).not.toContain('parent=');

    // The task 4 is now a root task: it shows up next to the other ones.
    const rows = treeRows(harness);
    expect(rows.map((row) => row.dataset['taskId'])).toEqual(['1', '2', '3', '4', '5']);
    expect(treeRow(harness, 4)?.dataset['depth']).toBe('0');
    expect(treeRow(harness, 2)?.dataset['depth']).toBe('1');

    harness.app.dispose();
  });

  it('makes a task a root task when it is dropped on the empty space of the list', async () => {
    const harness = await createTreeHarness();
    await switchToTree(harness);

    click(harness.root.querySelector<HTMLButtonElement>('.tree-row .tree-twisty'));
    await flush();
    click(harness.root.querySelectorAll<HTMLButtonElement>('.tree-row .tree-twisty')[1]);
    await flush();

    // The task 4 is dropped below the last row.
    dragTaskTo(harness, 4, harness.root.querySelector('.tree-rows'));
    await flush();

    const file = harness.bridge.files.get('/home/user/projects/task_4.txt');
    expect(file).not.toContain('parent=');
    expect(treeRow(harness, 4)?.dataset['depth']).toBe('0');

    harness.app.dispose();
  });

  it('goes back to the general root', async () => {
    const harness = await createTreeHarness();
    await switchToTree(harness);

    click(treeAction(harness, 1, 2));
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
    click(treeAction(harness, 1, 4));
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

describe('App and the board', () => {
  async function createBoardHarness(): Promise<Harness> {
    return createHarness(0, {
      tasks: [
        { id: 1 },
        { id: 2, parentId: 1 },
        { id: 3, parentId: 1 },
        { id: 4, parentId: 2 },
        { id: 5 },
      ],
      config: JSON.stringify({ projectDir: '/home/user/projects', pageSize: 10 }),
    });
  }

  async function switchToBoard(harness: Harness): Promise<void> {
    click(buttonByText(harness.doc, 'Kanban'));
    await flush();
  }

  it('shows one column per status, in the expected order', async () => {
    const harness = await createBoardHarness();
    await switchToBoard(harness);

    const columns = [...harness.root.querySelectorAll('.kanban-column')];
    expect(columns.map((column) => column.getAttribute('data-status'))).toEqual([
      'planning',
      'todo',
      'next',
      'paused',
      'doing',
      'done',
      'canceled',
    ]);
    expect(columns[0]?.querySelector('.kanban-column-title')?.textContent).toBe('PLANNING');
    expect(columns[2]?.querySelector('.kanban-column-title')?.textContent).toBe('NEXT');

    // The list and the tree are hidden, the pagination bar too.
    expect(harness.root.querySelector('.table-wrap')?.hasAttribute('hidden')).toBe(true);
    expect(harness.root.querySelector('.tree-wrap')?.hasAttribute('hidden')).toBe(true);
    expect(harness.root.querySelector('.pagination-footer')?.hasAttribute('hidden')).toBe(true);

    harness.app.dispose();
  });

  it('shows only the tasks that have no child', async () => {
    const harness = await createBoardHarness();
    await switchToBoard(harness);

    // The tasks 1 and 2 have a child: they are not on the board.
    const cards = [...harness.root.querySelectorAll('.kanban-card')];
    expect(cards.map((card) => card.getAttribute('data-task-id'))).toEqual(['3', '4', '5']);
    expect(harness.root.querySelector('.result-count')?.textContent).toBe('3 cards');

    harness.app.dispose();
  });

  it('searches the board and shows only the matching leaves', async () => {
    const harness = await createBoardHarness();
    await switchToBoard(harness);

    const search = harness.root.querySelector<HTMLInputElement>('#search-input');
    expect(search).not.toBeNull();
    if (search === null) {
      return;
    }
    search.value = 'marker-4';
    click(buttonByText(harness.doc, 'Search'));
    await flush();

    // The leaf that matches stays on the board; every other card is gone.
    let cards = [...harness.root.querySelectorAll('.kanban-card')];
    expect(cards.map((card) => card.getAttribute('data-task-id'))).toEqual(['4']);

    // Emptying the search box brings every card back.
    search.value = '';
    click(buttonByText(harness.doc, 'Search'));
    await flush();
    cards = [...harness.root.querySelectorAll('.kanban-card')];
    expect(cards.map((card) => card.getAttribute('data-task-id'))).toEqual(['3', '4', '5']);

    // Another search replaces the cards of the board.
    search.value = 'marker-5';
    click(buttonByText(harness.doc, 'Search'));
    await flush();
    cards = [...harness.root.querySelectorAll('.kanban-card')];
    expect(cards.map((card) => card.getAttribute('data-task-id'))).toEqual(['5']);

    harness.app.dispose();
  });

  it('changes the status of a task when its card is dropped on another column', async () => {
    const harness = await createBoardHarness();
    await switchToBoard(harness);

    // The card of the task 3 is dropped on the DOING column.
    dragCard(harness, 3, 'doing');
    await flush();

    const file = harness.bridge.files.get('/home/user/projects/task_3.txt');
    expect(file).toContain('status=doing');

    // The card moved to the column of its new status.
    const doing = harness.root.querySelector('.kanban-column[data-status="doing"]');
    expect(doing?.querySelectorAll('.kanban-card')).toHaveLength(1);
    expect(doing?.querySelector('.kanban-card')?.getAttribute('data-task-id')).toBe('3');

    harness.app.dispose();
  });

  it('opens the task of a card', async () => {
    const harness = await createBoardHarness();
    await switchToBoard(harness);

    click(harness.root.querySelector<HTMLButtonElement>('.kanban-card .kanban-card-title'));
    await flush();

    expect(harness.doc.querySelector('.modal-title')?.textContent).toContain('Task 3');

    harness.app.dispose();
  });
});

describe('App and the Gantt chart', () => {
  it('searches the chart and keeps the ancestors of the matches', async () => {
    const harness = await createGanttHarness();
    await switchToGantt(harness);

    const search = harness.root.querySelector<HTMLInputElement>('#search-input');
    expect(search).not.toBeNull();
    if (search === null) {
      return;
    }
    const names = (): (string | undefined)[] =>
      [...harness.root.querySelectorAll('.gantt-row-name')].map((row) => row.textContent);

    // Without a search only the task without a parent is on the chart.
    expect(names()).toEqual(['Task 1']);

    // The search shows the matches and their whole chain of ancestors: the
    // branch of the ancestor is opened by the search itself.
    search.value = 'marker-3';
    click(buttonByText(harness.doc, 'Search'));
    await flush();
    expect(names()).toEqual(['Task 1', 'Task 3']);

    // Emptying the search box brings back the default of the tree.
    search.value = '';
    click(buttonByText(harness.doc, 'Search'));
    await flush();
    expect(names()).toEqual(['Task 1']);

    harness.app.dispose();
  });

  async function createGanttHarness(): Promise<Harness> {
    const harness = await createHarness(0, {
      tasks: [
        { id: 1 },
        { id: 2, parentId: 1 },
        { id: 3, parentId: 1 },
      ],
      config: JSON.stringify({ projectDir: '/home/user/projects', pageSize: 10 }),
    });
    // The missing dates of the tests are already set: the tasks the tests do
    // not date explicitly are given a range inside the one of the task 1, so
    // the automatic assignment of the missing dates does not widen the chart.
    setDates(harness, 2, '20261019100000000', '20261023180000000');
    setDates(harness, 3, '20261019100000000', '20261023180000000');
    return harness;
  }

  /** Adds the dates of a task on the fake disk. */
  function setDates(harness: Harness, id: number, start: string, end: string): void {
    const path = `/home/user/projects/task_${id}.txt`;
    const content = harness.bridge.files.get(path);
    if (content === undefined) {
      return;
    }
    harness.bridge.files.set(
      path,
      content
        .replace(/^start=.*$/mu, `start=${start}`)
        .replace(/^end=.*$/mu, `end=${end}`),
    );
  }

  async function switchToGantt(harness: Harness): Promise<void> {
    click(buttonByText(harness.doc, 'Gantt'));
    await flush();
  }

  function ganttNames(harness: Harness): (string | undefined)[] {
    return [...harness.root.querySelectorAll('.gantt-row-name')].map((row) => row.textContent);
  }

  function ganttRow(harness: Harness, taskId: number): HTMLElement | null {
    return harness.root.querySelector<HTMLElement>(`.gantt-row[data-task-id="${taskId}"]`);
  }

  it('indents the rows of the chart by half of the indentation of the tree', async () => {
    const harness = await createGanttHarness();
    await switchToGantt(harness);

    expect(ganttRow(harness, 1)?.querySelector<HTMLElement>('.gantt-indent')?.style.width).toBe('0px');

    click(harness.root.querySelector<HTMLButtonElement>('.gantt-twisty'));
    await flush();

    expect(ganttRow(harness, 2)?.querySelector<HTMLElement>('.gantt-indent')?.style.width).toBe('9px');

    harness.app.dispose();
  });

  it('focuses the chart on a task and resets the focus from the breadcrumb', async () => {
    const harness = await createHarness(0, {
      tasks: [{ id: 1 }, { id: 2, parentId: 1 }, { id: 3, parentId: 1 }, { id: 4 }],
      config: JSON.stringify({ projectDir: '/home/user/projects', pageSize: 10 }),
    });
    await switchToGantt(harness);

    // The general root shows the tasks without a parent.
    expect(ganttNames(harness)).toEqual(['Task 1', 'Task 4']);

    // The first action focuses the chart on the task: the branch opens and the
    // tasks outside of it are hidden.
    click(ganttRow(harness, 1)?.querySelector<HTMLButtonElement>('[title="Focus the chart on this task"]'));
    await flush();
    expect(ganttNames(harness)).toEqual(['Task 1', 'Task 2', 'Task 3']);

    const crumbs = [...harness.root.querySelectorAll('.gantt-focus-crumb')];
    expect(crumbs.map((crumb) => crumb.textContent)).toEqual(['General root', 'Task 1']);

    // The first crumb resets the focus, like the header of the tree view.
    click(crumbs[0] ?? null);
    await flush();
    expect(ganttNames(harness)).toEqual(['Task 1', 'Task 2', 'Task 3', 'Task 4']);
    expect(harness.root.querySelector('.gantt-focus-crumb.is-active')?.textContent).toBe('General root');

    harness.app.dispose();
  });

  it('creates a child task from the actions of the chart', async () => {
    const harness = await createGanttHarness();
    await switchToGantt(harness);

    click(ganttRow(harness, 1)?.querySelector<HTMLButtonElement>('[title="Add a child task"]'));
    await flush();
    expect(harness.doc.querySelector('.modal-title')?.textContent).toContain('New child of task #1');

    const title = harness.doc.querySelector<HTMLInputElement>('#task-title');
    if (title === null) {
      return;
    }
    title.value = 'Child created from the chart';
    click(buttonByText(harness.doc, 'Create task'));
    await flush();

    expect(harness.bridge.files.get('/home/user/projects/task_4.txt')).toContain('parent=1');
    expect(ganttNames(harness)).toContain('Child created from the chart');

    harness.app.dispose();
  });

  it('shows the tasks on the left and the chart on the right', async () => {
    const harness = await createGanttHarness();
    setDates(harness, 1, '20261019100000000', '20261023180000000');
    await switchToGantt(harness);

    // The rows of the tasks are on the left: the tree is collapsed, so only
    // the task without a parent is shown.
    const rows = [...harness.root.querySelectorAll('.gantt-row')];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.querySelector('.gantt-row-name')?.textContent).toBe('Task 1');

    // The chart has one column per day of the schedule: the week of the task
    // (the 18th to the 24th of October) plus one margin week before (the 11th
    // to the 17th) and one after (the 25th to the 31st).
    const days = [...harness.root.querySelectorAll('.gantt-day')];
    expect(days).toHaveLength(21);
    expect(harness.root.querySelector('.gantt-bar')).not.toBeNull();

    // Expanding the task shows its children on the left.
    click(harness.root.querySelector<HTMLButtonElement>('.gantt-twisty'));
    await flush();
    expect(harness.root.querySelectorAll('.gantt-row')).toHaveLength(3);

    harness.app.dispose();
  });

  it('draws a bar from the start day to the end day of a task', async () => {
    const harness = await createGanttHarness();
    setDates(harness, 1, '20261019100000000', '20261023180000000');
    setDates(harness, 2, '20261021100000000', '20261022120000000');
    await switchToGantt(harness);

    // The task 1 goes from the 19th to the 23rd of October: five days. The
    // schedule starts one margin week before, on Sunday the 11th, so the bar
    // starts on the ninth column.
    const bars = [...harness.root.querySelectorAll<HTMLElement>('.gantt-bar')];
    expect(bars).toHaveLength(1);
    expect(bars[0]?.style.width).toBe('138px');
    expect(bars[0]?.style.left).toBe('224px');

    harness.app.dispose();
  });

  it('numbers and names the weeks and the months', async () => {
    const harness = await createGanttHarness();
    setDates(harness, 1, '20261019100000000', '20261110180000000');
    await switchToGantt(harness);

    const months = [...harness.root.querySelectorAll('.gantt-month')];
    expect(months.map((cell) => cell.textContent)).toEqual(['10October', '11November']);
    expect(months[0]?.querySelector('.gantt-header-number')?.textContent).toBe('10');
    expect(months[0]?.querySelector('.gantt-header-label')?.textContent).toBe('October');

    const weeks = [...harness.root.querySelectorAll('.gantt-week')];
    expect(weeks.length).toBeGreaterThan(1);
    expect(weeks[0]?.textContent).toContain('1');

    harness.app.dispose();
  });

  it('collapses and expands a week', async () => {
    const harness = await createGanttHarness();
    setDates(harness, 1, '20261019100000000', '20261023180000000');
    await switchToGantt(harness);

    const daysBefore = harness.root.querySelectorAll('.gantt-day').length;

    click(harness.root.querySelector<HTMLButtonElement>('.gantt-week'));
    await flush();

    // The days of the collapsed week are not drawn any more.
    expect(harness.root.querySelectorAll('.gantt-day').length).toBeLessThan(daysBefore);
    expect(harness.root.querySelector('.gantt-week')?.classList.contains('is-collapsed')).toBe(true);

    // Clicking again expands it.
    click(harness.root.querySelector<HTMLButtonElement>('.gantt-week'));
    await flush();
    expect(harness.root.querySelectorAll('.gantt-day')).toHaveLength(daysBefore);

    harness.app.dispose();
  });

  it('collapses and expands every week of a month when the month is clicked', async () => {
    const harness = await createGanttHarness();
    setDates(harness, 1, '20261019100000000', '20261110180000000');
    await switchToGantt(harness);

    const daysBefore = harness.root.querySelectorAll('.gantt-day').length;

    // Clicking the month collapses every week that holds a day of it.
    click(harness.root.querySelector<HTMLButtonElement>('.gantt-month'));
    await flush();
    expect(harness.root.querySelectorAll('.gantt-day').length).toBeLessThan(daysBefore);
    // The months are not collapsed themselves.
    expect(harness.root.querySelectorAll('.gantt-month.is-collapsed')).toHaveLength(0);

    // Clicking it again expands them.
    click(harness.root.querySelector<HTMLButtonElement>('.gantt-month'));
    await flush();
    expect(harness.root.querySelectorAll('.gantt-day')).toHaveLength(daysBefore);

    harness.app.dispose();
  });

  it('collapses a week starting in another month when its month is clicked', async () => {
    const harness = await createGanttHarness();
    // The 30th of September to the 2nd of October: the schedule covers the
    // weeks of the 20th and the 27th of September and of the 4th of October
    // (margins included). The week of the 27th starts in September but holds
    // days of October.
    setDates(harness, 1, '20260930100000000', '20261002180000000');
    setDates(harness, 2, '20260930100000000', '20261002180000000');
    setDates(harness, 3, '20260930100000000', '20261002180000000');
    await switchToGantt(harness);

    const months = [...harness.root.querySelectorAll<HTMLButtonElement>('.gantt-month')];
    const october = months.find((month) => month.textContent?.includes('October'));
    expect(october).not.toBeUndefined();

    const daysBefore = harness.root.querySelectorAll('.gantt-day').length;
    click(october ?? null);
    await flush();
    const daysAfter = harness.root.querySelectorAll('.gantt-day').length;
    // Both weeks holding October days collapse: the spanning week and the
    // week fully in October.
    expect(daysAfter).toBeLessThan(daysBefore);

    click(october ?? null);
    await flush();
    expect(harness.root.querySelectorAll('.gantt-day')).toHaveLength(daysBefore);

    harness.app.dispose();
  });

  it('keeps one margin week before the smallest start and after the largest end', async () => {
    const harness = await createGanttHarness();
    setDates(harness, 1, '20261019100000000', '20261023180000000');
    setDates(harness, 2, '20261019100000000', '20261023180000000');
    setDates(harness, 3, '20261019100000000', '20261023180000000');
    await switchToGantt(harness);

    // The tasks run from the 19th to the 23rd of October (week of the 18th):
    // the chart shows that week plus the full weeks of the 11th and the 25th.
    const weeks = [...harness.root.querySelectorAll('.gantt-week')];
    expect(weeks).toHaveLength(3);
    const days = harness.root.querySelectorAll('.gantt-day');
    expect(days).toHaveLength(21);

    harness.app.dispose();
  });

  it('draws the week of the end date when it falls in the next month', async () => {
    const harness = await createGanttHarness();
    setDates(harness, 1, '20261028100000000', '20261104180000000');
    setDates(harness, 2, '20261028100000000', '20261104180000000');
    setDates(harness, 3, '20261028100000000', '20261104180000000');
    await switchToGantt(harness);

    const months = [...harness.root.querySelectorAll('.gantt-month')].map(
      (cell) => cell.textContent,
    );
    expect(months).toContain('10October');
    expect(months).toContain('11November');

    // The week of the end (the 1st to the 7th of November) and one week after
    // it (the 8th to the 14th) are both drawn.
    const weeks = [...harness.root.querySelectorAll('.gantt-week')];
    expect(weeks.length).toBeGreaterThanOrEqual(4);

    harness.app.dispose();
  });

  it('computes the schedule from the displayed rows only', async () => {
    const harness = await createHarness(0, {
      tasks: [{ id: 1 }, { id: 2, parentId: 1 }, { id: 3, parentId: 1 }, { id: 4 }],
      config: JSON.stringify({ projectDir: '/home/user/projects', pageSize: 10 }),
    });
    setDates(harness, 1, '20261019100000000', '20261023180000000');
    setDates(harness, 2, '20261019100000000', '20261023180000000');
    setDates(harness, 3, '20261019100000000', '20261023180000000');
    // Task 4 is far away in December: it is only shown at the general root.
    setDates(harness, 4, '20261201100000000', '20261202180000000');
    await switchToGantt(harness);

    // Focusing on task 1 hides task 4: the schedule ignores its December
    // dates and stays around October.
    click(ganttRow(harness, 1)?.querySelector<HTMLButtonElement>('[title="Focus the chart on this task"]'));
    await flush();
    const months = [...harness.root.querySelectorAll('.gantt-month')].map(
      (cell) => cell.textContent,
    );
    expect(months).not.toContain('12December');
    expect(harness.root.querySelectorAll('.gantt-day')).toHaveLength(21);

    harness.app.dispose();
  });

  it('alternates the background of the day columns', async () => {
    const harness = await createGanttHarness();
    setDates(harness, 1, '20261019100000000', '20261023180000000');
    await switchToGantt(harness);

    const days = [...harness.root.querySelectorAll('.gantt-day')];
    expect(days.length).toBeGreaterThan(2);
    // The days alternate between the two colours.
    expect(days[0]?.classList.contains('is-alt')).toBe(false);
    expect(days[1]?.classList.contains('is-alt')).toBe(true);
    expect(days[2]?.classList.contains('is-alt')).toBe(false);

    // The body of the chart is striped the same way.
    const stripes = harness.root.querySelectorAll('.gantt-stripe');
    expect(stripes).toHaveLength(Math.floor(days.length / 2));

    harness.app.dispose();
  });

  it('expands the whole branch of a task with a ctrl+click', async () => {
    const harness = await createGanttHarness();
    setDates(harness, 1, '20261019100000000', '20261023180000000');
    await switchToGantt(harness);

    // The task 1 is collapsed: only it is shown.
    expect(harness.root.querySelectorAll('.gantt-row')).toHaveLength(1);

    // A ctrl+click expands the task and all its children.
    ctrlClick(harness.root.querySelector<HTMLButtonElement>('.gantt-twisty'), harness.dom);
    await flush();
    expect(harness.root.querySelectorAll('.gantt-row')).toHaveLength(3);

    // A ctrl+click collapses them again.
    ctrlClick(harness.root.querySelector<HTMLButtonElement>('.gantt-twisty'), harness.dom);
    await flush();
    expect(harness.root.querySelectorAll('.gantt-row')).toHaveLength(1);

    harness.app.dispose();
  });

  it('explains that no task has a date', async () => {
    // The tasks without dates receive the day of today and the day of tomorrow
    // on the load, so the empty chart only happens on a project without task.
    const harness = await createHarness(0, {
      tasks: [],
      config: JSON.stringify({ projectDir: '/home/user/projects', pageSize: 10 }),
    });
    await switchToGantt(harness);

    expect(harness.root.querySelector('.gantt-empty')?.textContent).toContain('start or an end date');

    harness.app.dispose();
  });

  it('changes the dates of a task when its bar is dragged', async () => {
    const harness = await createGanttHarness();
    setDates(harness, 1, '20261019100000000', '20261023180000000');
    await switchToGantt(harness);

    const bar = harness.root.querySelector<HTMLElement>('.gantt-bar');
    expect(bar).not.toBeNull();
    if (bar === null) {
      return;
    }
    const label = bar.querySelector<HTMLElement>('.gantt-bar-label');
    if (label === null) {
      return;
    }

    // The bar is dragged one day to the left: the start and the end are
    // shifted by the same number of days.
    const from = 3 * 28 + 4;
    label.dispatchEvent(
      new harness.dom.window.MouseEvent('mousedown', {
        bubbles: true,
        clientX: from,
        clientY: 10,
        button: 0,
      }),
    );
    harness.doc.dispatchEvent(
      new harness.dom.window.MouseEvent('mousemove', {
        bubbles: true,
        clientX: from - 28,
        clientY: 10,
        button: 0,
      }),
    );
    harness.doc.dispatchEvent(
      new harness.dom.window.MouseEvent('mouseup', {
        bubbles: true,
        clientX: from - 28,
        clientY: 10,
        button: 0,
      }),
    );
    await flush();

    // The dates of the file moved with the bar.
    const file = harness.bridge.files.get('/home/user/projects/task_1.txt');
    expect(file).toContain('start=20261018000000000');
    expect(file).toContain('end=20261022000000000');

    harness.app.dispose();
  });
});

describe('the notes', () => {
  it('shows the notes of the folder, ten per page', async () => {
    const harness = await createHarness(0, {
      notes: Array.from({ length: 25 }, (_value, index) => ({ id: index + 1 })),
    });
    await selectFolder(harness);
    await openNotes(harness);

    const rows = harness.root.querySelectorAll('.note-table tbody tr');
    expect(rows).toHaveLength(10);
    expect(harness.root.querySelector('.page-current')?.textContent).toBe('1');
    expect(harness.root.querySelector('.page-total')?.textContent).toBe('3');
    expect(harness.root.querySelector('.pagination-summary')?.textContent).toBe(
      'Showing 1-10 of 25 notes',
    );
    expect(harness.root.querySelector('.result-count')?.textContent).toBe('25 notes');
    harness.app.dispose();
  });

  it('hides the tasks and shows the notes', async () => {
    const harness = await createHarness(3, { notes: [{ id: 1, title: 'A note' }] });
    await selectFolder(harness);
    await openNotes(harness);

    expect(harness.root.querySelector('.task-table:not(.note-table)')?.hasAttribute('hidden')).toBe(
      false,
    );
    expect(harness.root.querySelector('.notes-wrap')?.hasAttribute('hidden')).toBe(false);
    expect(harness.root.querySelector('.note-table tbody tr')).not.toBeNull();
    harness.app.dispose();
  });

  it('moves between the pages of the notes', async () => {
    const harness = await createHarness(0, {
      notes: Array.from({ length: 25 }, (_value, index) => ({ id: index + 1 })),
    });
    await selectFolder(harness);
    await openNotes(harness);

    click(harness.root.querySelector<HTMLButtonElement>('.page-last'));
    await flush();
    expect(harness.root.querySelector('.page-current')?.textContent).toBe('3');
    expect(harness.root.querySelectorAll('.note-table tbody tr')).toHaveLength(5);

    click(harness.root.querySelector<HTMLButtonElement>('.page-first'));
    await flush();
    expect(harness.root.querySelector('.page-current')?.textContent).toBe('1');
    harness.app.dispose();
  });

  it('jumps to the page the user types', async () => {
    const harness = await createHarness(0, {
      notes: Array.from({ length: 25 }, (_value, index) => ({ id: index + 1 })),
    });
    await selectFolder(harness);
    await openNotes(harness);

    const jump = harness.root.querySelector<HTMLInputElement>('.page-jump-input');
    expect(jump).not.toBeNull();
    if (jump === null) {
      return;
    }
    jump.value = '3';
    jump.dispatchEvent(
      new harness.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    await flush();

    expect(harness.root.querySelector('.page-current')?.textContent).toBe('3');
    expect(harness.root.querySelectorAll('.note-table tbody tr')).toHaveLength(5);
    harness.app.dispose();
  });

  it('changes the amount of notes per page', async () => {
    const harness = await createHarness(0, {
      notes: Array.from({ length: 25 }, (_value, index) => ({ id: index + 1 })),
      config: JSON.stringify({ projectDir: '/home/user/projects', pageSize: 10 }),
    });
    await selectFolder(harness);
    await openNotes(harness);

    const size = harness.root.querySelector<HTMLInputElement>('.page-size-input');
    expect(size).not.toBeNull();
    if (size === null) {
      return;
    }
    expect(size.min).toBe('10');
    expect(size.max).toBe('100');
    size.value = '25';
    size.dispatchEvent(new harness.dom.window.Event('change', { bubbles: true }));
    await flush();

    expect(harness.root.querySelectorAll('.note-table tbody tr')).toHaveLength(25);
    expect(harness.root.querySelector('.page-total')?.textContent).toBe('1');

    // The amount is kept in the configuration of the project.
    const config = harness.bridge.files.get('~/.config/GnumarusProjectManager/config.json');
    expect(config).toContain('"notePageSize": 25');
    harness.app.dispose();
  });

  it('searches the notes by title, by content or by both', async () => {
    const harness = await createHarness(0, {
      notes: [
        { id: 1, title: 'Shopping list', content: 'Remember the milk' },
        { id: 2, title: 'A recipe', content: 'The shopping list is empty' },
      ],
    });
    await selectFolder(harness);
    await openNotes(harness);

    const scope = harness.root.querySelector<HTMLSelectElement>('#note-scope');
    expect(scope).not.toBeNull();
    expect(scope?.hasAttribute('hidden')).toBe(false);
    if (scope === null) {
      return;
    }

    const search = harness.root.querySelector<HTMLInputElement>('#search-input');
    if (search === null) {
      return;
    }
    search.value = 'shopping';
    click(buttonByText(harness.doc, 'Search'));
    await flush();

    // Both notes hold the term, one in its title and one in its body.
    expect(harness.root.querySelectorAll('.note-table tbody tr')).toHaveLength(2);

    scope.value = 'title';
    scope.dispatchEvent(new harness.dom.window.Event('change', { bubbles: true }));
    await flush();
    expect(harness.root.querySelectorAll('.note-table tbody tr')).toHaveLength(1);

    scope.value = 'content';
    scope.dispatchEvent(new harness.dom.window.Event('change', { bubbles: true }));
    await flush();
    expect(harness.root.querySelectorAll('.note-table tbody tr')).toHaveLength(1);
    expect(harness.root.querySelector('.note-table tbody tr .cell-title')?.textContent).toContain(
      'A recipe',
    );
    harness.app.dispose();
  });

  it('creates a note, with its id inside the file', async () => {
    const harness = await createHarness(0);
    await selectFolder(harness);
    await openNotes(harness);

    click(buttonByText(harness.doc, 'New note'));
    await flush();

    const title = harness.doc.querySelector<HTMLInputElement>('#note-title');
    const content = harness.doc.querySelector<HTMLTextAreaElement>('#note-content');
    expect(title).not.toBeNull();
    expect(content).not.toBeNull();
    if (title === null || content === null) {
      return;
    }
    title.value = 'The new note';
    content.value = '# The body';
    click(buttonByText(harness.doc, 'Create note'));
    await flush();

    const file = harness.bridge.files.get('/home/user/projects/note_1.txt');
    expect(file).toContain('id=1');
    expect(file).toContain('title=The new note');
    expect(file).toContain('----');
    expect(file).toContain('# The body');
    expect(harness.root.querySelector('.note-table tbody tr .cell-title')?.textContent).toContain(
      'The new note',
    );
    harness.app.dispose();
  });

  it('shows the note as markdown and edits it as plain text', async () => {
    const harness = await createHarness(0, {
      notes: [{ id: 1, title: 'A note', content: '# The title\n\nSome **bold** text.' }],
    });
    await selectFolder(harness);
    await openNotes(harness);

    // The read only view shows the note as markdown.
    click(harness.root.querySelector<HTMLButtonElement>('.note-table tbody tr .row-action'));
    await flush();
    const view = harness.doc.querySelector('.note-dialog .markdown');
    expect(view).not.toBeNull();
    expect(view?.querySelector('h1')?.textContent).toBe('The title');
    expect(view?.querySelector('strong')?.textContent).toBe('bold');

    // The editor of the note holds the markdown source.
    click(buttonByText(harness.doc, 'Edit'));
    await flush();
    const source = harness.doc.querySelector<HTMLTextAreaElement>('#note-content');
    expect(source?.value).toContain('# The title');

    // The preview shows the rendered markdown.
    click(buttonByText(harness.doc, 'Preview'));
    await flush();
    const preview = harness.doc.querySelector('.note-preview');
    expect(preview?.hasAttribute('hidden')).toBe(false);
    expect(preview?.querySelector('h1')?.textContent).toBe('The title');
    expect(preview?.querySelector('strong')?.textContent).toBe('bold');
    harness.app.dispose();
  });

  it('edits a note', async () => {
    const harness = await createHarness(0, { notes: [{ id: 1, title: 'Old title' }] });
    await selectFolder(harness);
    await openNotes(harness);

    const actions = harness.root.querySelectorAll<HTMLButtonElement>('.note-table tbody tr .row-action');
    click(actions[1]);
    await flush();

    const title = harness.doc.querySelector<HTMLInputElement>('#note-title');
    if (title === null) {
      return;
    }
    title.value = 'The edited title';
    click(buttonByText(harness.doc, 'Save changes'));
    await flush();

    const file = harness.bridge.files.get('/home/user/projects/note_1.txt');
    expect(file).toContain('title=The edited title');
    expect(file).toContain('id=1');
    harness.app.dispose();
  });

  it('deletes a note', async () => {
    const harness = await createHarness(0, { notes: [{ id: 1, title: 'Doomed note' }] });
    await selectFolder(harness);
    await openNotes(harness);

    const actions = harness.root.querySelectorAll<HTMLButtonElement>('.note-table tbody tr .row-action');
    click(actions[2]);
    await flush();

    click(buttonByText(harness.doc, 'Delete'));
    await flush();
    click(buttonByText(harness.doc, 'Yes, delete'));
    await flush();

    expect(harness.bridge.files.has('/home/user/projects/note_1.txt')).toBe(false);
    expect(harness.root.querySelectorAll('.note-table tbody tr')).toHaveLength(0);
    harness.app.dispose();
  });

  it('hides the scope of the search in the other display modes', async () => {
    const harness = await createHarness(0, { notes: [{ id: 1 }] });
    await selectFolder(harness);

    const scope = harness.root.querySelector<HTMLSelectElement>('#note-scope');
    expect(scope?.hasAttribute('hidden')).toBe(true);

    await openNotes(harness);
    expect(scope?.hasAttribute('hidden')).toBe(false);
    harness.app.dispose();
  });
});



describe('the embedded project', () => {
  it('is the default when the browser offers the OPFS and knows nothing', async () => {
    // The browser does not offer the File System Access API: the OPFS comes
    // first, then the service.
    const harness = await createHarness(0, { mode: 'default', fileSystemAvailable: false });

    // The project needs no folder: the files live at the root of the storage
    // of the browser.
    expect(harness.root.querySelector('.empty-title')?.textContent).toBe(
      'The project does not contain any task yet',
    );
    expect(harness.root.querySelector('.project-path')?.textContent).toContain('Embedded project');
    harness.app.dispose();
  });

  it('creates a task without asking for a folder', async () => {
    const harness = await createHarness(0, { mode: 'embedded' });

    click(buttonByText(harness.doc, 'New task'));
    await flush();

    // The editor of the task opens: there is no folder to choose in the
    // embedded mode.
    expect(harness.doc.querySelector('#task-title')).not.toBeNull();
    expect(harness.root.querySelector('.toast-message')?.textContent).toBeUndefined();
    harness.app.dispose();
  });

  it('creates a note without asking for a folder', async () => {
    const harness = await createHarness(0, { mode: 'embedded' });
    await openNotes(harness);

    click(buttonByText(harness.doc, 'New note'));
    await flush();

    expect(harness.doc.querySelector('#note-title')).not.toBeNull();
    harness.app.dispose();
  });

  it('writes the files of the project at the root of the OPFS', async () => {
    const harness = await createHarness(0, { mode: 'embedded' });

    click(buttonByText(harness.doc, 'New task'));
    await flush();
    const title = harness.doc.querySelector<HTMLInputElement>('#task-title');
    expect(title).not.toBeNull();
    if (title === null) {
      harness.app.dispose();
      return;
    }
    title.value = 'A task of the embedded project';
    click(buttonByText(harness.doc, 'Create task'));
    await flush();

    // The file of the task lives at the root of the storage of the browser.
    const root = harness.opfs as unknown as { read: (path: string) => string | null };
    const content = root.read('task_1.txt');
    expect(content).toContain('id=1');
    expect(content).toContain('title=A task of the embedded project');
    harness.app.dispose();
  });

  it('shows the name of the storage of the browser', async () => {
    const harness = await createHarness(0, { mode: 'embedded' });

    // The test environment offers the OPFS.
    expect(harness.root.querySelector('.project-path')?.textContent).toBe(
      'Embedded project (OPFS)',
    );
    const path = harness.root.querySelector('.project-path');
    expect(path?.getAttribute('title')).toContain('root of the');
    harness.app.dispose();
  });

  it('does not ask for a folder in the empty state', async () => {
    const harness = await createHarness(0, { mode: 'embedded' });

    const button = harness.root.querySelector('.empty-state button');
    expect(button?.textContent).toBe('New task');
    expect(button?.textContent).not.toContain('folder');
    harness.app.dispose();
  });

  it('finds the folder of the service in the configuration file', async () => {
    const harness = await createHarness(0, {
      mode: 'embedded',
      config: JSON.stringify({ projectDir: '/home/user/projects', pageSize: 10 }),
    });

    // The user works on the project of the service: the folder is read again
    // from the configuration file of the machine.
    click(buttonByText(harness.doc, 'Project…'));
    await flush();
    const choices = harness.doc.querySelectorAll('.project-choice');
    click(choices[0] ?? null);
    await flush();

    expect(harness.root.querySelector('.project-path')?.textContent).toBe('/home/user/projects');
    harness.app.dispose();
  });

  it('keeps the folder of the service when it comes back', async () => {
    const harness = await createHarness(0, { mode: 'service' });
    await selectFolder(harness);
    const folder = harness.root.querySelector('.project-path')?.textContent;
    expect(folder).not.toBeNull();

    // The user works on the embedded project.
    click(buttonByText(harness.doc, 'Project…'));
    await flush();
    const choices = harness.doc.querySelectorAll('.project-choice');
    click(choices[1] ?? null);
    await flush();
    expect(harness.root.querySelector('.project-path')?.textContent).toContain('Embedded project');

    // The user comes back to the service: the folder is still there.
    click(buttonByText(harness.doc, 'Project…'));
    await flush();
    const again = harness.doc.querySelectorAll('.project-choice');
    click(again[0] ?? null);
    await flush();
    expect(harness.root.querySelector('.project-path')?.textContent).toBe(folder);
    harness.app.dispose();
  });
});

describe('the File System Access API', () => {
  it('is the default when the browser offers it and knows nothing', async () => {
    const harness = await createHarness(3, { mode: 'default', fileSystemAvailable: true });
    // The mode is not stored: the browser knows nothing about a project.
    expect(harness.root.querySelector('.empty-title')?.textContent).toBe(
      'Choose the folder of your project',
    );
    harness.app.dispose();
  });

  it('asks for the folder of the project', async () => {
    const harness = await createHarness(3, { mode: 'filesystem', folderKnown: false });

    expect(harness.root.querySelector('.empty-title')?.textContent).toBe(
      'Choose the folder of your project',
    );
    expect(harness.root.querySelector('.empty-message')?.textContent).toContain(
      'File System Access API',
    );
    harness.app.dispose();
  });

  it('lists the tasks of the folder the user chose', async () => {
    const harness = await createHarness(3, { mode: 'filesystem' });

    const rows = harness.root.querySelectorAll('.task-table tbody tr');
    expect(rows).toHaveLength(3);
    expect(harness.root.querySelector('.project-path')?.textContent).toBe('project');
    expect(harness.root.querySelector('.result-count')?.textContent).toBe('3 tasks');
    harness.app.dispose();
  });

  it('shows the notes of the folder', async () => {
    const harness = await createHarness(0, {
      mode: 'filesystem',
      notes: [{ id: 1, title: 'A note' }],
    });
    await openNotes(harness);

    expect(harness.root.querySelectorAll('.note-table tbody tr')).toHaveLength(1);
    harness.app.dispose();
  });

  it('opens the picker of the browser to choose a folder', async () => {
    const harness = await createHarness(2, { mode: 'filesystem', folderKnown: false });

    click(buttonByText(harness.doc, 'Choose folder…'));
    await flush();

    // The folder is chosen: the tasks of the project are shown.
    expect(harness.root.querySelectorAll('.task-table tbody tr').length).toBeGreaterThan(0);
    expect(harness.root.querySelector('.project-path')?.textContent).toBe('project');
    harness.app.dispose();
  });

  it('does not need the service', async () => {
    const harness = await createHarness(3, { mode: 'filesystem' });

    expect(harness.root.querySelector('.service-text')?.textContent).toBe('Service not needed');
    // The banner of the unreachable service is not shown.
    expect(harness.root.querySelector('.banner')?.hasAttribute('hidden')).toBe(true);
    // The token would be useless: the button is hidden.
    const tokenButton = [...harness.root.querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === 'API token',
    );
    expect(tokenButton === undefined || tokenButton.hasAttribute('hidden')).toBe(true);
    harness.app.dispose();
  });

  it('asks for the permission of the folder', async () => {
    const harness = await createHarness(3, { mode: 'filesystem', folderKnown: false });

    // The browser asks for the permission again.
    const handle = fakeDirectoryHandle('project') as unknown as {
      queryPermission?: () => Promise<PermissionState>;
    };
    handle.queryPermission = async (): Promise<PermissionState> => 'prompt';
    await harness.handleStorage.write(handle as unknown as FileSystemDirectoryHandle);
    await harness.app.start();
    await flush();

    expect(harness.root.querySelector('.empty-title')?.textContent).toBe(
      'Give the access to the folder "project"',
    );
    expect(harness.root.querySelector('.empty-state button')?.textContent).toBe(
      'Grant the access',
    );
    harness.app.dispose();
  });

  it('offers the three choices in the dialog of the project', async () => {
    const harness = await createHarness(0);

    click(buttonByText(harness.doc, 'Project…'));
    await flush();

    const choices = harness.doc.querySelectorAll('.project-choice');
    expect(choices).toHaveLength(3);
    expect(choices[0]?.textContent).toContain('Gnumarus OS Bridge');
    expect(choices[1]?.textContent).toContain('embedded project');
    expect(choices[2]?.textContent).toContain('File System Access API');
    // The test environment offers both APIs: every choice is possible.
    expect(choices[1]?.hasAttribute('disabled')).toBe(false);
    expect(choices[2]?.hasAttribute('disabled')).toBe(false);
    harness.app.dispose();
  });

  it('refuses the choices the browser does not offer', async () => {
    const harness = await createHarness(0, { fileSystemAvailable: false });

    click(buttonByText(harness.doc, 'Project…'));
    await flush();

    const choices = harness.doc.querySelectorAll('.project-choice');
    expect(choices).toHaveLength(3);
    expect(choices[2]?.hasAttribute('disabled')).toBe(true);
    expect(choices[2]?.textContent).toContain('does not offer the File System Access API');
    harness.app.dispose();
  });
});

/** Opens the notes of the project. */
async function openNotes(harness: Harness): Promise<void> {
  click(buttonByText(harness.doc, 'Notes'));
  await flush();
}

export async function selectFolder(harness: Harness): Promise<void> {
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
