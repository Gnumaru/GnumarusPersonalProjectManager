import { describe, expect, it } from 'vite-plus/test';
import {
  DEFAULT_CONFIG,
  MAX_NOTE_PAGE_SIZE,
  MIN_NOTE_PAGE_SIZE,
  MODE_STORAGE_KEY,
  clampNotePageSize,
  defaultMode,
  isProjectKind,
  parseConfig,
  readMode,
  serializeConfig,
  writeMode,
} from './config.js';

/** A storage of the configuration, in memory. */
class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('parseConfig', () => {
  it('reads a valid configuration', () => {
    const config = parseConfig('{"projectDir":"/home/user/projects","pageSize":25}');
    expect(config.projectDir).toBe('/home/user/projects');
    expect(config.pageSize).toBe(25);
    expect(config.mode).toBe('service');
    expect(config.notePageSize).toBe(10);
  });

  it('reads the embedded mode', () => {
    const config = parseConfig('{"mode":"embedded","pageSize":25}');
    expect(config.mode).toBe('embedded');
    expect(config.projectDir).toBeNull();
  });

  it('falls back to the defaults for broken content', () => {
    expect(parseConfig('not json')).toEqual(DEFAULT_CONFIG);
    expect(parseConfig('[]')).toEqual(DEFAULT_CONFIG);
    expect(parseConfig('{"projectDir":42}').projectDir).toBeNull();
    expect(parseConfig('{"pageSize":-3}').pageSize).toBe(10);
  });

  it('reads the amount of notes per page', () => {
    expect(parseConfig('{"notePageSize":42}').notePageSize).toBe(42);
    expect(parseConfig('{"notePageSize":0}').notePageSize).toBe(MIN_NOTE_PAGE_SIZE);
    expect(parseConfig('{"notePageSize":1000}').notePageSize).toBe(MAX_NOTE_PAGE_SIZE);
    expect(parseConfig('{"notePageSize":"many"}').notePageSize).toBe(10);
  });
});

describe('clampNotePageSize', () => {
  it('keeps the amount inside the allowed range', () => {
    expect(clampNotePageSize(10)).toBe(10);
    expect(clampNotePageSize(50)).toBe(50);
    expect(clampNotePageSize(100)).toBe(100);
    expect(clampNotePageSize(9)).toBe(10);
    expect(clampNotePageSize(101)).toBe(100);
    expect(clampNotePageSize(Number.NaN)).toBe(10);
    expect(clampNotePageSize(25.7)).toBe(25);
  });
});

describe('the kind of storage', () => {
  it('knows the three kinds', () => {
    expect(isProjectKind('service')).toBe(true);
    expect(isProjectKind('embedded')).toBe(true);
    expect(isProjectKind('filesystem')).toBe(true);
    expect(isProjectKind('other')).toBe(false);
  });

  it('remembers the kind the user chose', () => {
    const storage = new MemoryStorage();

    writeMode('filesystem', storage);
    expect(storage.getItem(MODE_STORAGE_KEY)).toBe('filesystem');
    expect(readMode(storage)).toBe('filesystem');

    writeMode('embedded', storage);
    expect(readMode(storage)).toBe('embedded');
  });

  it('chooses the default when the browser knows nothing', () => {
    const storage = new MemoryStorage();
    // The window offers neither API: the service is the last choice.
    expect(readMode(storage, null)).toBe('service');
    expect(defaultMode(null)).toBe('service');
  });

  it('prefers the File System Access API, then the OPFS', () => {
    const withPicker = {} as Window;
    withPicker.showDirectoryPicker = async (): Promise<FileSystemDirectoryHandle> =>
      ({}) as FileSystemDirectoryHandle;

    // The File System Access API comes first.
    expect(defaultMode(withPicker)).toBe('filesystem');

    // The Origin Private File System comes next.
    const withOpfs = {
      navigator: {
        storage: {
          getDirectory: async (): Promise<FileSystemDirectoryHandle> =>
            ({}) as FileSystemDirectoryHandle,
        },
      },
    } as unknown as Window;
    expect(defaultMode(withOpfs)).toBe('embedded');
  });
});

describe('serializeConfig', () => {
  it('writes readable json', () => {
    const content = serializeConfig({
      mode: 'service',
      projectDir: '/tmp',
      pageSize: 10,
      notePageSize: 20,
    });
    expect(JSON.parse(content)).toEqual({
      mode: 'service',
      projectDir: '/tmp',
      pageSize: 10,
      notePageSize: 20,
    });
  });

  it('round trips', () => {
    const config = {
      mode: 'service' as const,
      projectDir: '/home/user/tasks',
      pageSize: 10,
      notePageSize: 25,
    };
    expect(parseConfig(serializeConfig(config))).toEqual(config);
  });
});
