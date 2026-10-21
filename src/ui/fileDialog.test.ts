import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vite-plus/test';
import { ApiClient } from '../api/client.js';
import { FakeBridge } from '../test-support/fakeBridge.js';
import { FileDialog, compareEntries, formatSize, parentDirectory } from './fileDialog.js';
import type { DirectoryEntry } from '../api/client.js';

function entry(name: string): DirectoryEntry {
  return { name, path: `/tmp/${name}`, type: 'file', size: 0, mtime: 0 };
}

describe('parentDirectory', () => {
  it('returns the parent of a path', () => {
    expect(parentDirectory('/home/user/projects')).toBe('/home/user');
    expect(parentDirectory('/home/user/')).toBe('/home');
    expect(parentDirectory('/home')).toBe('/');
  });

  it('returns null for the root', () => {
    expect(parentDirectory('/')).toBeNull();
    expect(parentDirectory('')).toBeNull();
  });
});

describe('formatSize', () => {
  it('formats the sizes', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('compareEntries', () => {
  it('sorts the names in a natural order', () => {
    const names = ['task_10.txt', 'task_2.txt', 'task_1.txt'];
    const sorted = [...names].sort((left, right) =>
      compareEntries(entry(left), entry(right)),
    );
    expect(sorted).toEqual(['task_1.txt', 'task_2.txt', 'task_10.txt']);
  });
});

interface Harness {
  readonly dialog: FileDialog;
  readonly doc: Document;
  readonly dom: JSDOM;
  readonly selected: string[];
}

async function createHarness(): Promise<Harness> {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const doc = dom.window.document;
  const root = doc.createElement('div');
  doc.body.append(root);

  const bridge = new FakeBridge({ token: 'test-token' });
  bridge.directories.add('/home/user');
  bridge.directories.add('/home/user/projects');
  bridge.addFile('/home/user/projects/task_1.txt', 'hello');

  const api = new ApiClient({ baseUrl: bridge.baseUrl, token: 'test-token', fetchImpl: bridge.fetch });
  const selected: string[] = [];
  const dialog = new FileDialog({
    doc,
    api,
    mode: 'directory',
    onSelect: (path) => {
      selected.push(path);
    },
  });

  return { dialog, doc, dom, selected };
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
  (element as { click?: () => void }).click?.();
}

function entryNamed(doc: Document, name: string): Element | null {
  return (
    [...doc.querySelectorAll('.fd-entry')].find(
      (node) => node.querySelector('.fd-entry-name')?.textContent === name,
    ) ?? null
  );
}

function pressEnter(harness: Harness): void {
  harness.doc.dispatchEvent(
    new harness.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
  );
}

describe('FileDialog', () => {
  it('does not rebuild the list when an item is selected', async () => {
    const harness = await createHarness();
    await harness.dialog.open('/home/user');

    const list = harness.doc.querySelector('.fd-list');
    const row = entryNamed(harness.doc, 'projects');
    expect(row).not.toBeNull();

    click(row);

    // The very same row is still in the list: the list was not emptied, so the
    // scroll of the dialog cannot be reset by a click.
    expect(list?.contains(row)).toBe(true);
    expect(row?.classList.contains('fd-entry-selected')).toBe(true);
    expect(harness.doc.querySelector('.fd-selection')?.textContent).toBe('/home/user/projects');
  });

  it('enters the selected directory when Enter is pressed', async () => {
    const harness = await createHarness();
    await harness.dialog.open('/home/user');

    click(entryNamed(harness.doc, 'projects'));
    pressEnter(harness);
    await flush();

    expect(harness.doc.querySelector<HTMLInputElement>('.path-input')?.value).toBe(
      '/home/user/projects',
    );
    expect(harness.doc.querySelector('.fd-entry-name')?.textContent).toBe('task_1.txt');
  });

  it('does nothing when Enter is pressed and nothing is selected', async () => {
    const harness = await createHarness();
    await harness.dialog.open('/home/user');

    pressEnter(harness);
    await flush();

    expect(harness.doc.querySelector<HTMLInputElement>('.path-input')?.value).toBe('/home/user');
  });

  it('lets the path box handle the Enter key', async () => {
    const harness = await createHarness();
    await harness.dialog.open('/home/user');

    click(entryNamed(harness.doc, 'projects'));

    const pathInput = harness.doc.querySelector<HTMLInputElement>('.path-input');
    expect(pathInput).not.toBeNull();
    if (pathInput === null) {
      return;
    }
    pathInput.value = '/home/user/projects';
    pathInput.dispatchEvent(
      new harness.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    await flush();

    expect(pathInput.value).toBe('/home/user/projects');
  });

  it('enters the folder of a row that has the focus', async () => {
    const harness = await createHarness();
    await harness.dialog.open('/home/user');

    const row = entryNamed(harness.doc, 'projects');
    expect(row).not.toBeNull();
    row?.dispatchEvent(
      new harness.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    await flush();

    expect(harness.doc.querySelector<HTMLInputElement>('.path-input')?.value).toBe(
      '/home/user/projects',
    );
  });
});
