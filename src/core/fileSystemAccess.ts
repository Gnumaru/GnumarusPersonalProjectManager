/**
 * The File System Access API of the browser.
 *
 * The API gives the application the access to a folder of the disk of the
 * machine, chosen by the user with the picker of the browser. The files of the
 * project are then read and written **directly on the disk**, without the low
 * level service of Gnumarus.
 *
 * The API is only offered by the **Chromium based browsers** (Chrome, Edge,
 * Opera). The application checks for it before offering the choice:
 * `supportsFileSystemAccess()` answers `false` everywhere else.
 *
 * The handle of the chosen directory is kept in an **IndexedDB** database, so
 * the project is still there the next time the page is opened. The permission
 * is not kept: the browser asks the user again, and the application asks for
 * it with a button.
 */

import { supportsIndexedDb } from './browserStorage.js';

const DATABASE_NAME = 'gnumarus-project-manager-handles';
const DATABASE_STORE = 'handles';
const HANDLE_KEY = 'project-directory';

/**
 * The handle of the directory of the project, as the browser sees it.
 *
 * `null` when the user has not chosen any folder yet.
 */
export type DirectoryHandle = FileSystemDirectoryHandle;

/** True when the browser offers the File System Access API. */
export function supportsFileSystemAccess(win: Window | null = globalWindow()): boolean {
  return win !== null && typeof win.showDirectoryPicker === 'function';
}

/** The window of the page, `null` when there is none. */
function globalWindow(): Window | null {
  return typeof window === 'undefined' ? null : window;
}

/**
 * Shows the picker of the browser: the user chooses the folder of the project.
 *
 * `null` when the user closes the picker without choosing anything. The method
 * must be called from a user gesture: the browser refuses it otherwise.
 */
export async function pickProjectDirectory(
  win: Window | null = globalWindow(),
): Promise<DirectoryHandle | null> {
  if (win === null || typeof win.showDirectoryPicker !== 'function') {
    return null;
  }
  try {
    return await win.showDirectoryPicker({ mode: 'readwrite', id: 'gnumarus-project-manager' });
  } catch {
    // The user closed the picker: it is not an error.
    return null;
  }
}

/**
 * The state of the permission of the handle, without asking the user.
 *
 * `granted` when the access is already allowed, `prompt` when the browser
 * will ask the user and `denied` when the access is refused.
 */
export async function checkPermission(handle: DirectoryHandle): Promise<PermissionState> {
  if (typeof handle.queryPermission !== 'function') {
    // The browser does not tell the state of the permission: the access is
    // assumed to be allowed.
    return 'granted';
  }
  try {
    return await handle.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}

/**
 * Asks the user for the access to the directory.
 *
 * The browser only allows this method when it is called from a user gesture.
 */
export async function requestPermission(handle: DirectoryHandle): Promise<PermissionState> {
  if (typeof handle.requestPermission !== 'function') {
    return 'granted';
  }
  try {
    return await handle.requestPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}

/**
 * Where the handle of the directory of the project is kept between two visits.
 *
 * The handle is a value the browser can store: it is kept in an IndexedDB
 * database. When the browser offers no database, the handle is kept in the
 * memory of the page and the user has to choose the folder again the next
 * time the page is opened.
 */
export interface DirectoryHandleStorage {
  /** The name of the storage, for the messages of the user interface. */
  readonly name: string;
  /** True when the handle survives the closing of the page. */
  readonly persistent: boolean;
  /** The handle of the directory, `null` when there is none. */
  read(): Promise<DirectoryHandle | null>;
  /** Keeps the handle of the directory. */
  write(handle: DirectoryHandle): Promise<void>;
  /** Forgets the handle of the directory. */
  clear(): Promise<void>;
}

/** Creates the best storage of the handle the browser offers. */
export function createDirectoryHandleStorage(): DirectoryHandleStorage {
  if (supportsIndexedDb()) {
    return new IndexedDbHandleStorage();
  }
  return new MemoryHandleStorage();
}

/** The storage of the handle in an IndexedDB database. */
class IndexedDbHandleStorage implements DirectoryHandleStorage {
  readonly name = 'IndexedDB';
  readonly persistent = true;

  private database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(DATABASE_STORE)) {
          database.createObjectStore(DATABASE_STORE);
        }
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('The database could not be opened'));
      };
    });
  }

  private async transaction<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await this.database();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(DATABASE_STORE, mode);
      const request = action(transaction.objectStore(DATABASE_STORE));
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('The database request failed'));
      };
      transaction.oncomplete = () => {
        database.close();
      };
    });
  }

  async read(): Promise<DirectoryHandle | null> {
    try {
      const value = await this.transaction<unknown>('readonly', (store) => store.get(HANDLE_KEY));
      return isDirectoryHandle(value) ? value : null;
    } catch {
      return null;
    }
  }

  async write(handle: DirectoryHandle): Promise<void> {
    await this.transaction('readwrite', (store) => store.put(handle, HANDLE_KEY));
  }

  async clear(): Promise<void> {
    await this.transaction('readwrite', (store) => store.delete(HANDLE_KEY));
  }
}

/** The storage of the handle in the memory of the page. */
class MemoryHandleStorage implements DirectoryHandleStorage {
  readonly name = 'the memory of the page (the folder is asked again the next time)';
  readonly persistent = false;

  private handle: DirectoryHandle | null = null;

  async read(): Promise<DirectoryHandle | null> {
    return this.handle;
  }

  async write(handle: DirectoryHandle): Promise<void> {
    this.handle = handle;
  }

  async clear(): Promise<void> {
    this.handle = null;
  }
}

/** True when the value is a handle of a directory. */
function isDirectoryHandle(value: unknown): value is DirectoryHandle {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const handle = value as { kind?: unknown; getFileHandle?: unknown };
  return handle.kind === 'directory' && typeof handle.getFileHandle === 'function';
}
