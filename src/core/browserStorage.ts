/**
 * The storage of the files of an embedded project.
 *
 * The **Origin Private File System** is used when the browser offers it: it is
 * a real file system, the paths of the project are kept as they are and the
 * export to a ZIP archive is a straight copy.
 *
 * When the OPFS is not available (an old browser, a page that is not in a
 * secure context), the files fall back to an **IndexedDB** database, which
 * stores the same paths and the same contents.
 *
 * When the browser offers neither (a very old browser, a page that blocks the
 * databases), the files are kept in the memory of the page: the project is
 * then lost when the page is closed, and the export to a ZIP archive is the
 * only way to keep it.
 */

/** The storage of the files of a project. */
export interface BrowserFileStorage {
  /** The name of the storage, for the messages of the user interface. */
  readonly name: string;
  /** True when the files survive the closing of the page. */
  readonly persistent: boolean;
  /** The content of a file, `null` when the file does not exist. */
  read(path: string): Promise<string | null>;
  /** Writes a file, creating the folders it needs. */
  write(path: string, content: string): Promise<void>;
  /** Removes a file. */
  remove(path: string): Promise<void>;
  /** The paths of every file. */
  list(): Promise<string[]>;
  /** Removes every file. */
  clear(): Promise<void>;
}

const DATABASE_NAME = 'gnumarus-project-manager';
const DATABASE_STORE = 'files';

/** True when the browser offers the Origin Private File System. */
export function supportsOpfs(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function'
  );
}

/** True when the browser offers an IndexedDB database. */
export function supportsIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

/** Creates the best storage the browser offers. */
export async function createBrowserFileStorage(): Promise<BrowserFileStorage> {
  if (supportsOpfs()) {
    try {
      return new OpfsFileStorage();
    } catch {
      // The OPFS is there but it refused to open: fall back to IndexedDB.
    }
  }
  if (supportsIndexedDb()) {
    return new IndexedDbFileStorage();
  }
  return new MemoryFileStorage();
}

/** The storage backed by the Origin Private File System. */
class OpfsFileStorage implements BrowserFileStorage {
  readonly name = 'OPFS';
  readonly persistent = true;

  private async root(): Promise<FileSystemDirectoryHandle> {
    return navigator.storage.getDirectory();
  }

  /** The directory that holds a file, `null` when it does not exist. */
  private async directoryOf(path: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
    const parts = path.split('/').filter((part) => part.length > 0);
    const fileName = parts.pop();
    if (fileName === undefined) {
      return null;
    }
    let current = await this.root();
    for (const part of parts) {
      try {
        current = await current.getDirectoryHandle(part, { create });
      } catch {
        return null;
      }
    }
    return current;
  }

  async read(path: string): Promise<string | null> {
    const parts = path.split('/').filter((part) => part.length > 0);
    const fileName = parts.pop();
    if (fileName === undefined) {
      return null;
    }
    const directory = await this.directoryOf(path, false);
    if (directory === null) {
      return null;
    }
    try {
      const handle = await directory.getFileHandle(fileName);
      const file = await handle.getFile();
      return await file.text();
    } catch {
      return null;
    }
  }

  async write(path: string, content: string): Promise<void> {
    const parts = path.split('/').filter((part) => part.length > 0);
    const fileName = parts.pop();
    if (fileName === undefined) {
      return;
    }
    const directory = await this.directoryOf(path, true);
    if (directory === null) {
      return;
    }
    const handle = await directory.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async remove(path: string): Promise<void> {
    const parts = path.split('/').filter((part) => part.length > 0);
    const fileName = parts.pop();
    if (fileName === undefined) {
      return;
    }
    const directory = await this.directoryOf(path, false);
    if (directory === null) {
      return;
    }
    try {
      await directory.removeEntry(fileName);
    } catch {
      // The file was already gone.
    }
  }

  async list(): Promise<string[]> {
    const paths: string[] = [];
    await this.collect('', paths);
    return paths.sort((left, right) => left.localeCompare(right));
  }

  /** Walks the tree of directories and collects the paths of the files. */
  private async collect(prefix: string, paths: string[]): Promise<void> {
    let directory: FileSystemDirectoryHandle;
    try {
      directory = await this.root();
    } catch {
      return;
    }
    if (prefix.length > 0) {
      const parts = prefix.split('/');
      const name = parts.pop();
      if (name === undefined) {
        return;
      }
      try {
        directory = await directory.getDirectoryHandle(name);
      } catch {
        return;
      }
    }
    for await (const [name, handle] of directory.entries()) {
      const path = prefix.length === 0 ? name : `${prefix}/${name}`;
      if (handle.kind === 'directory') {
        await this.collect(path, paths);
      } else {
        paths.push(path);
      }
    }
  }

  async clear(): Promise<void> {
    const directory = await this.root();
    for await (const [name] of directory.entries()) {
      try {
        await directory.removeEntry(name, { recursive: true });
      } catch {
        // The entry was already gone.
      }
    }
  }
}

/** The storage backed by an IndexedDB database. */
class IndexedDbFileStorage implements BrowserFileStorage {
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

  async read(path: string): Promise<string | null> {
    const value = await this.transaction<unknown>('readonly', (store) => store.get(path));
    return typeof value === 'string' ? value : null;
  }

  async write(path: string, content: string): Promise<void> {
    await this.transaction('readwrite', (store) => store.put(content, path));
  }

  async remove(path: string): Promise<void> {
    await this.transaction('readwrite', (store) => store.delete(path));
  }

  async list(): Promise<string[]> {
    const keys = await this.transaction<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
    return keys
      .filter((key): key is string => typeof key === 'string')
      .sort((left, right) => left.localeCompare(right));
  }

  async clear(): Promise<void> {
    await this.transaction('readwrite', (store) => store.clear());
  }
}

/**
 * The last resort storage: the files live in the memory of the page.
 *
 * The browser offers neither the OPFS nor the databases: the project then only
 * lasts as long as the page is open, and the export to a ZIP archive is the
 * only way to keep it.
 */
class MemoryFileStorage implements BrowserFileStorage {
  readonly name = 'the memory of the page (the project is lost when the page is closed)';
  readonly persistent = false;

  private readonly files = new Map<string, string>();

  async read(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async list(): Promise<string[]> {
    return [...this.files.keys()].sort((left, right) => left.localeCompare(right));
  }

  async clear(): Promise<void> {
    this.files.clear();
  }
}
