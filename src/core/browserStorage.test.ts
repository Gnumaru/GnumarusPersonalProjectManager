import { describe, expect, it } from 'vite-plus/test';
import {
  createBrowserFileStorage,
  supportsIndexedDb,
  supportsOpfs,
} from './browserStorage.js';
import { fakeDirectoryHandle } from '../test-support/fakeDirectory.js';

/** A window that offers the Origin Private File System. */
function windowWithOpfs(root: FileSystemDirectoryHandle): Window {
  return {
    navigator: {
      storage: {
        getDirectory: async (): Promise<FileSystemDirectoryHandle> => root,
      },
    },
  } as unknown as Window;
}

describe('the storage of the browser', () => {
  it('tells which storages the browser offers', () => {
    expect(typeof supportsOpfs()).toBe('boolean');
    expect(typeof supportsIndexedDb()).toBe('boolean');
  });

  it('always offers a storage that can hold the files', async () => {
    const storage = await createBrowserFileStorage();

    expect(storage.name.length).toBeGreaterThan(0);
    expect(typeof storage.persistent).toBe('boolean');
    expect(await storage.list()).toEqual([]);
  });

  it('detects the Origin Private File System of the window', () => {
    const root = fakeDirectoryHandle('opfs');
    expect(supportsOpfs(windowWithOpfs(root))).toBe(true);
    expect(supportsOpfs(null)).toBe(false);
    expect(supportsOpfs({} as Window)).toBe(false);
  });

  it('keeps the files of the project at the root of the OPFS', async () => {
    const root = fakeDirectoryHandle('opfs');
    const storage = await createBrowserFileStorage(windowWithOpfs(root));

    expect(storage.name).toBe('OPFS');
    expect(storage.persistent).toBe(true);

    await storage.write('task_1.txt', 'id=1');
    await storage.write('nested/task_2.txt', 'id=2');

    // The files live at the root of the Origin Private File System.
    const fake = root as unknown as { read: (path: string) => string | null };
    expect(fake.read('task_1.txt')).toBe('id=1');
    expect(fake.read('nested/task_2.txt')).toBe('id=2');
    expect(await storage.list()).toEqual(['nested/task_2.txt', 'task_1.txt']);
  });

  it('keeps the files of the project', async () => {
    const storage = await createBrowserFileStorage();

    await storage.write('task_1.txt', 'id=1');
    await storage.write('nested/task_2.txt', 'id=2');

    expect(await storage.read('task_1.txt')).toBe('id=1');
    expect(await storage.read('nested/task_2.txt')).toBe('id=2');
    expect(await storage.read('task_9.txt')).toBeNull();
    expect(await storage.list()).toEqual(['nested/task_2.txt', 'task_1.txt']);

    await storage.remove('task_1.txt');
    expect(await storage.read('task_1.txt')).toBeNull();
    expect(await storage.list()).toEqual(['nested/task_2.txt']);

    await storage.clear();
    expect(await storage.list()).toEqual([]);
  });
});
