/**
 * An in memory fake of the File System Access API.
 *
 * The API is only offered by the Chromium based browsers: the test suite
 * cannot rely on it. This fake implements the small part of the API the
 * application uses: the files and the folders of a directory.
 */

interface FakeEntry {
  readonly kind: 'file' | 'directory';
  readonly name: string;
}

/** A file of the fake file system. */
class FakeFile implements FakeEntry {
  readonly kind = 'file';
  readonly name: string;
  content = '';

  constructor(name: string) {
    this.name = name;
  }

  async getFile(): Promise<File> {
    return toFile(this.name, this.content);
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    const file = this;
    const stream = {
      async write(data: FileSystemWriteChunkType): Promise<void> {
        file.content = typeof data === 'string' ? data : String(data);
      },
      async close(): Promise<void> {
        // Nothing to do: the content is already written.
      },
      async abort(): Promise<void> {
        // Nothing to do.
      },
    };
    return stream as unknown as FileSystemWritableFileStream;
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return other.name === this.name && other.kind === this.kind;
  }
}

/** A directory of the fake file system. */
export class FakeDirectory implements FakeEntry {
  readonly kind = 'directory';
  readonly name: string;
  readonly children = new Map<string, FakeDirectory | FakeFile>();

  constructor(name: string) {
    this.name = name;
  }

  /** Adds a file, with its folders. */
  addFile(path: string, content: string): void {
    const parts = path.split('/').filter((part) => part.length > 0);
    const fileName = parts.pop();
    if (fileName === undefined) {
      return;
    }
    let current: FakeDirectory = this;
    for (const part of parts) {
      let child = current.children.get(part);
      if (!(child instanceof FakeDirectory)) {
        child = new FakeDirectory(part);
        current.children.set(part, child);
      }
      current = child;
    }
    const file = new FakeFile(fileName);
    file.content = content;
    current.children.set(fileName, file);
  }

  /** The content of a file, `null` when it does not exist. */
  read(path: string): string | null {
    const parts = path.split('/').filter((part) => part.length > 0);
    const fileName = parts.pop();
    if (fileName === undefined) {
      return null;
    }
    let current: FakeDirectory = this;
    for (const part of parts) {
      const child = current.children.get(part);
      if (!(child instanceof FakeDirectory)) {
        return null;
      }
      current = child;
    }
    const file = current.children.get(fileName);
    return file instanceof FakeFile ? file.content : null;
  }

  async getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<FileSystemFileHandle> {
    const entry = this.children.get(name);
    if (entry instanceof FakeFile) {
      return entry as unknown as FileSystemFileHandle;
    }
    if (options?.create === true) {
      const file = new FakeFile(name);
      this.children.set(name, file);
      return file as unknown as FileSystemFileHandle;
    }
    throw new Error(`The file "${name}" does not exist.`);
  }

  async getDirectoryHandle(
    name: string,
    options?: FileSystemGetDirectoryOptions,
  ): Promise<FileSystemDirectoryHandle> {
    const entry = this.children.get(name);
    if (entry instanceof FakeDirectory) {
      return entry as unknown as FileSystemDirectoryHandle;
    }
    if (options?.create === true) {
      const directory = new FakeDirectory(name);
      this.children.set(name, directory);
      return directory as unknown as FileSystemDirectoryHandle;
    }
    throw new Error(`The folder "${name}" does not exist.`);
  }

  async removeEntry(name: string, options?: FileSystemRemoveOptions): Promise<void> {
    const entry = this.children.get(name);
    if (entry === undefined) {
      throw new Error(`The entry "${name}" does not exist.`);
    }
    if (entry instanceof FakeDirectory && options?.recursive !== true) {
      if (entry.children.size > 0) {
        throw new Error('The folder is not empty.');
      }
    }
    this.children.delete(name);
  }

  async resolve(): Promise<string[] | null> {
    return null;
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return other.name === this.name && other.kind === this.kind;
  }

  async *entries(): AsyncGenerator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]> {
    for (const [name, entry] of this.children) {
      yield [name, entry as unknown as FileSystemDirectoryHandle | FileSystemFileHandle];
    }
  }

  async *keys(): AsyncGenerator<string> {
    for (const name of this.children.keys()) {
      yield name;
    }
  }

  async *values(): AsyncGenerator<FileSystemDirectoryHandle | FileSystemFileHandle> {
    for (const entry of this.children.values()) {
      yield entry as unknown as FileSystemDirectoryHandle | FileSystemFileHandle;
    }
  }

  [Symbol.asyncIterator](): AsyncGenerator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]> {
    return this.entries();
  }
}

/** The handle of the directory, as the application sees it. */
export function fakeDirectoryHandle(name = 'project'): FileSystemDirectoryHandle {
  return new FakeDirectory(name) as unknown as FileSystemDirectoryHandle;
}

/** Builds the file of the fake file system. */
function toFile(name: string, content: string): File {
  const file = {
    name,
    size: content.length,
    text: async (): Promise<string> => content,
    slice: (start = 0, end = content.length): File =>
      toFile(name, content.slice(start, end === undefined ? content.length : end)),
  };
  return file as unknown as File;
}
