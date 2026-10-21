import { describe, expect, it } from 'vite-plus/test';
import {
  createBrowserFileStorage,
  supportsIndexedDb,
  supportsOpfs,
} from './browserStorage.js';

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
