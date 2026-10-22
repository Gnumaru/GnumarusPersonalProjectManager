import { describe, expect, it } from 'vite-plus/test';
import {
  checkPermission,
  createDirectoryHandleStorage,
  pickProjectDirectory,
  requestPermission,
  supportsFileSystemAccess,
} from './fileSystemAccess.js';
import { fakeDirectoryHandle } from '../test-support/fakeDirectory.js';

/** A window that offers the File System Access API. */
function windowWithPicker(handle: FileSystemDirectoryHandle | Error): Window {
  const win = {} as Window;
  win.showDirectoryPicker = async (): Promise<FileSystemDirectoryHandle> => {
    if (handle instanceof Error) {
      throw handle;
    }
    return handle;
  };
  return win;
}

describe('supportsFileSystemAccess', () => {
  it('is false when the browser does not offer the API', () => {
    expect(supportsFileSystemAccess(null)).toBe(false);
    expect(supportsFileSystemAccess({} as Window)).toBe(false);
  });

  it('is true when the browser offers the picker', () => {
    expect(supportsFileSystemAccess(windowWithPicker(fakeDirectoryHandle()))).toBe(true);
  });
});

describe('pickProjectDirectory', () => {
  it('returns the folder the user chose', async () => {
    const handle = fakeDirectoryHandle('chosen');
    const picked = await pickProjectDirectory(windowWithPicker(handle));
    expect(picked).toBe(handle);
  });

  it('returns null when the user closes the picker', async () => {
    const picked = await pickProjectDirectory(windowWithPicker(new Error('aborted')));
    expect(picked).toBeNull();
  });

  it('returns null when the browser does not offer the API', async () => {
    expect(await pickProjectDirectory(null)).toBeNull();
    expect(await pickProjectDirectory({} as Window)).toBeNull();
  });
});

describe('the permission of the folder', () => {
  it('asks the browser for the state of the permission', async () => {
    const handle = fakeDirectoryHandle() as unknown as {
      queryPermission?: () => Promise<PermissionState>;
    };
    handle.queryPermission = async (): Promise<PermissionState> => 'prompt';

    expect(await checkPermission(handle as unknown as FileSystemDirectoryHandle)).toBe('prompt');
  });

  it('asks the user for the access', async () => {
    const handle = fakeDirectoryHandle() as unknown as {
      requestPermission?: () => Promise<PermissionState>;
    };
    handle.requestPermission = async (): Promise<PermissionState> => 'granted';

    expect(await requestPermission(handle as unknown as FileSystemDirectoryHandle)).toBe('granted');
  });

  it('is granted when the browser does not tell', async () => {
    const handle = fakeDirectoryHandle();
    expect(await checkPermission(handle)).toBe('granted');
    expect(await requestPermission(handle)).toBe('granted');
  });
});

describe('the storage of the handle of the folder', () => {
  it('keeps the handle between two visits', async () => {
    const storage = createDirectoryHandleStorage();
    const handle = fakeDirectoryHandle('project');

    expect(await storage.read()).toBeNull();

    await storage.write(handle);
    expect(await storage.read()).toBe(handle);

    await storage.clear();
    expect(await storage.read()).toBeNull();
  });
});
