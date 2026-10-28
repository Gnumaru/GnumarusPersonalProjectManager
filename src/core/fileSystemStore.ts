/**
 * The implementation of the project store that uses the File System Access API.
 *
 * The files of the project live in a folder of the disk of the machine, chosen
 * by the user with the picker of the browser. They are read and written
 * **directly**, without the low level service of Gnumarus.
 *
 * The API offers no `find` and no `grep`: the listing and the search are done
 * in JavaScript, over the entries of the directory. Only the files that are
 * needed are read: the metadata of a task is read from the first bytes of the
 * file, so the descriptions never reach the memory.
 */

import {
  buildComment,
  commentFileName,
  isCommentFileName,
  parseComment,
  parseCommentIdFromFileName,
  serializeComment,
  sortComments,
  type TaskComment,
} from './comment.js';
import {
  isTaskFileName,
  parseTask,
  parseTaskIdFromFileName,
  serializeTask,
  taskFileName,
  type Task,
} from './task.js';
import {
  isNoteFileName,
  noteFileName,
  noteMatches,
  parseNote,
  parseNoteIdFromFileName,
  serializeNote,
  type Note,
  type NoteSearchScope,
} from './note.js';
import type { NoteSummary, ProjectFile, ProjectKind, ProjectStore, TaskSummary } from './projectStore.js';
import { APP_CONFIG_FILE } from './appConfig.js';
import type { DirectoryHandle } from './fileSystemAccess.js';

/**
 * The amount of bytes read to get the metadata of a file.
 *
 * The metadata block is at the beginning of the file: reading the first bytes
 * is enough to know the parent, the status, the title, the tags and the dates
 * of a task, and the title of a note.
 */
const METADATA_BYTES = 8192;

export class FileSystemProjectStore implements ProjectStore {
  readonly kind: ProjectKind = 'filesystem';
  private readonly root: DirectoryHandle;

  constructor(root: DirectoryHandle) {
    this.root = root;
  }

  // --------------------------------------------------------------- tasks --

  async listTaskPaths(): Promise<readonly string[]> {
    return (await this.listTaskPathsInternal()).map((path) => path);
  }

  async searchTaskPaths(term: string): Promise<readonly string[]> {
    const needle = term.trim().toLowerCase();
    const paths = await this.listTaskPathsInternal();
    if (needle.length === 0) {
      return paths;
    }
    const matches: string[] = [];
    for (const path of paths) {
      const content = await this.readFile(path);
      if (content !== null && content.toLowerCase().includes(needle)) {
        matches.push(path);
      }
    }
    return matches;
  }

  async listTasks(): Promise<readonly TaskSummary[]> {
    const summaries: TaskSummary[] = [];
    for (const path of await this.listTaskPathsInternal()) {
      const summary = await this.readTaskSummary(path);
      if (summary !== null) {
        summaries.push(summary);
      }
    }
    return summaries;
  }

  async childCounts(): Promise<ReadonlyMap<number, number>> {
    const counts = new Map<number, number>();
    for (const task of await this.listTasks()) {
      if (task.parentId !== null) {
        counts.set(task.parentId, (counts.get(task.parentId) ?? 0) + 1);
      }
    }
    return counts;
  }

  async commentCounts(): Promise<ReadonlyMap<number, number>> {
    const counts = new Map<number, number>();
    for (const path of await this.listCommentPathsInternal()) {
      const content = await this.readFile(path);
      if (content === null) {
        continue;
      }
      const comment = parseComment(content, parseCommentIdFromFileName(nameOf(path)) ?? undefined);
      counts.set(comment.taskId, (counts.get(comment.taskId) ?? 0) + 1);
    }
    return counts;
  }

  async readTask(path: string): Promise<Task> {
    const content = await this.readFile(path);
    if (content === null) {
      throw new Error(`The file "${path}" does not exist in the project folder.`);
    }
    return parseTask(content, parseTaskIdFromFileName(nameOf(path)) ?? undefined);
  }

  async writeTask(path: string, task: Task): Promise<void> {
    await this.writeFile(path, serializeTask(task));
  }

  async createTaskFile(path: string, task: Task): Promise<void> {
    if (await this.exists(path)) {
      throw new Error(`The file "${path}" already exists in the project folder.`);
    }
    await this.writeFile(path, serializeTask(task));
  }

  async deleteFile(path: string): Promise<void> {
    await this.removeFile(path);
  }

  async readAppConfig(): Promise<string | null> {
    return this.readFile(APP_CONFIG_FILE);
  }

  async writeAppConfig(content: string): Promise<void> {
    await this.writeFile(APP_CONFIG_FILE, content);
  }

  // ------------------------------------------------------------ comments --

  async listComments(taskId: number): Promise<readonly TaskComment[]> {
    const comments: TaskComment[] = [];
    for (const path of await this.listCommentPathsInternal()) {
      const content = await this.readFile(path);
      if (content === null) {
        continue;
      }
      const comment = parseComment(content, parseCommentIdFromFileName(nameOf(path)) ?? undefined);
      if (comment.taskId === taskId) {
        comments.push(comment);
      }
    }
    return sortComments(comments);
  }

  async createComment(taskId: number, text: string): Promise<TaskComment> {
    const id = await this.nextCommentId();
    const comment = buildComment(id, taskId, text, new Date());
    await this.writeFile(this.commentPath(id), serializeComment(comment));
    return comment;
  }

  async writeComment(comment: TaskComment): Promise<void> {
    await this.writeFile(this.commentPath(comment.id), serializeComment(comment));
  }

  async deleteComment(path: string): Promise<void> {
    await this.removeFile(path);
  }

  // --------------------------------------------------------------- notes --

  async listNotePaths(): Promise<readonly string[]> {
    return this.listNotePathsInternal();
  }

  async listNoteSummaries(): Promise<readonly NoteSummary[]> {
    const paths = await this.listNotePathsInternal();
    const summaries: NoteSummary[] = [];
    for (const path of paths) {
      const head = await this.readHead(path, METADATA_BYTES);
      const content = head === null ? null : head.includes('----') ? head : await this.readFile(path);
      if (content === null) {
        continue;
      }
      const note = parseNote(content, parseNoteIdFromFileName(nameOf(path)) ?? undefined);
      summaries.push({ id: note.id, title: note.title, updated: note.updated, path });
    }
    return summaries;
  }

  async searchNotePaths(term: string, scope: NoteSearchScope): Promise<readonly string[]> {
    const needle = term.trim();
    const paths = await this.listNotePathsInternal();
    if (needle.length === 0) {
      return paths;
    }
    const matches: string[] = [];
    for (const path of paths) {
      const content = await this.readFile(path);
      if (content === null) {
        continue;
      }
      const note = parseNote(content, parseNoteIdFromFileName(nameOf(path)) ?? undefined);
      if (noteMatches(note, needle, scope)) {
        matches.push(path);
      }
    }
    return matches;
  }

  async readNote(path: string): Promise<Note> {
    const content = await this.readFile(path);
    if (content === null) {
      throw new Error(`The file "${path}" does not exist in the project folder.`);
    }
    return parseNote(content, parseNoteIdFromFileName(nameOf(path)) ?? undefined);
  }

  async writeNote(path: string, note: Note): Promise<void> {
    await this.writeFile(path, serializeNote(note));
  }

  async createNoteFile(path: string, note: Note): Promise<void> {
    if (await this.exists(path)) {
      throw new Error(`The file "${path}" already exists in the project folder.`);
    }
    await this.writeFile(path, serializeNote(note));
  }

  // ----------------------------------------------------------------- ids --

  async nextTaskId(): Promise<number> {
    return this.nextId(await this.listTaskPathsInternal(), parseTaskIdFromFileName);
  }

  async nextCommentId(): Promise<number> {
    return this.nextId(await this.listCommentPathsInternal(), parseCommentIdFromFileName);
  }

  async nextNoteId(): Promise<number> {
    return this.nextId(await this.listNotePathsInternal(), parseNoteIdFromFileName);
  }

  taskPath(id: number): string {
    return taskFileName(id);
  }

  commentPath(id: number): string {
    return commentFileName(id);
  }

  notePath(id: number): string {
    return noteFileName(id);
  }

  // ---------------------------------------------------------- the archive --

  async listFiles(): Promise<readonly ProjectFile[]> {
    const files: ProjectFile[] = [];
    for (const path of await this.listAllPaths()) {
      const content = await this.readFile(path);
      if (content !== null) {
        files.push({ path, content });
      }
    }
    return files;
  }

  async replaceAll(files: readonly ProjectFile[]): Promise<void> {
    await this.clearDirectory();
    for (const file of files) {
      await this.writeFile(file.path, file.content);
    }
  }

  // ------------------------------------------------------------ internals --

  /** The paths of the task files, sorted by task id. */
  private async listTaskPathsInternal(): Promise<string[]> {
    return sortById(
      (await this.listAllPaths()).filter((path) => isTaskFileName(nameOf(path))),
      parseTaskIdFromFileName,
    );
  }

  /** The paths of the comment files, sorted by comment id. */
  private async listCommentPathsInternal(): Promise<string[]> {
    return sortById(
      (await this.listAllPaths()).filter((path) => isCommentFileName(nameOf(path))),
      parseCommentIdFromFileName,
    );
  }

  /** The paths of the note files, sorted by note id. */
  private async listNotePathsInternal(): Promise<string[]> {
    return sortById(
      (await this.listAllPaths()).filter((path) => isNoteFileName(nameOf(path))),
      parseNoteIdFromFileName,
    );
  }

  /** The paths of every file of the project folder. */
  private async listAllPaths(): Promise<string[]> {
    const paths: string[] = [];
    await this.collect('', paths);
    return paths;
  }

  /** Walks the tree of directories and collects the paths of the files. */
  private async collect(prefix: string, paths: string[]): Promise<void> {
    const directory = await this.directoryOf(prefix, false);
    if (directory === null) {
      return;
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

  /** The directory that holds a file, `null` when it does not exist. */
  private async directoryOf(path: string, create: boolean): Promise<DirectoryHandle | null> {
    const parts = path.split('/').filter((part) => part.length > 0);
    let current = this.root;
    for (const part of parts) {
      try {
        current = await current.getDirectoryHandle(part, { create });
      } catch {
        return null;
      }
    }
    return current;
  }

  /** The content of a file, `null` when it does not exist. */
  private async readFile(path: string): Promise<string | null> {
    const parts = path.split('/').filter((part) => part.length > 0);
    const fileName = parts.pop();
    if (fileName === undefined) {
      return null;
    }
    const directory = await this.directoryOf(parts.join('/'), false);
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

  /** The first bytes of a file, `null` when it does not exist. */
  private async readHead(path: string, bytes: number): Promise<string | null> {
    const parts = path.split('/').filter((part) => part.length > 0);
    const fileName = parts.pop();
    if (fileName === undefined) {
      return null;
    }
    const directory = await this.directoryOf(parts.join('/'), false);
    if (directory === null) {
      return null;
    }
    try {
      const handle = await directory.getFileHandle(fileName);
      const file = await handle.getFile();
      return await file.slice(0, bytes).text();
    } catch {
      return null;
    }
  }

  /** Writes a file, creating the folders it needs. */
  private async writeFile(path: string, content: string): Promise<void> {
    const parts = path.split('/').filter((part) => part.length > 0);
    const fileName = parts.pop();
    if (fileName === undefined) {
      return;
    }
    const directory = await this.directoryOf(parts.join('/'), true);
    if (directory === null) {
      throw new Error(`Unable to reach the folder of "${path}".`);
    }
    const handle = await directory.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  /** Removes a file. */
  private async removeFile(path: string): Promise<void> {
    const parts = path.split('/').filter((part) => part.length > 0);
    const fileName = parts.pop();
    if (fileName === undefined) {
      return;
    }
    const directory = await this.directoryOf(parts.join('/'), false);
    if (directory === null) {
      return;
    }
    try {
      await directory.removeEntry(fileName);
    } catch {
      // The file was already gone.
    }
  }

  /** True when the file exists. */
  private async exists(path: string): Promise<boolean> {
    const parts = path.split('/').filter((part) => part.length > 0);
    const fileName = parts.pop();
    if (fileName === undefined) {
      return false;
    }
    const directory = await this.directoryOf(parts.join('/'), false);
    if (directory === null) {
      return false;
    }
    try {
      await directory.getFileHandle(fileName);
      return true;
    } catch {
      return false;
    }
  }

  /** Removes every file of the project folder. */
  private async clearDirectory(): Promise<void> {
    for await (const [name] of this.root.entries()) {
      try {
        await this.root.removeEntry(name, { recursive: true });
      } catch {
        // The entry was already gone.
      }
    }
  }

  /**
   * The metadata of a task, read from the first bytes of its file.
   *
   * The description of the task never reaches the memory.
   */
  private async readTaskSummary(path: string): Promise<TaskSummary | null> {
    const head = await this.readHead(path, METADATA_BYTES);
    if (head === null) {
      return null;
    }
    const content = head.includes('----') ? head : await this.readFile(path);
    if (content === null) {
      return null;
    }
    const task = parseTask(content, parseTaskIdFromFileName(nameOf(path)) ?? undefined);
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      parentId: task.parentId,
      tags: task.tags,
      start: task.start,
      end: task.end,
      updated: task.updated,
      expanded: task.expanded,
      kanbanHidden: task.kanbanHidden ?? false,
      treeGanttHidden: task.treeGanttHidden ?? false,
      kanbanOrder: task.kanbanOrder ?? 0,
      treeGanttOrder: task.treeGanttOrder ?? 0,
      path,
    };
  }

  /** The id that the next file of that kind will take. */
  private async nextId(
    paths: readonly string[],
    parseId: (name: string) => number | null,
  ): Promise<number> {
    const ids: number[] = [];
    for (const path of paths) {
      const id = parseId(nameOf(path));
      if (id !== null) {
        ids.push(id);
      }
    }
    return ids.length === 0 ? 1 : Math.max(...ids) + 1;
  }
}

/** The name of a file, without its folders. */
function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Sorts the paths by the id encoded in their name. */
function sortById(
  paths: readonly string[],
  parseId: (name: string) => number | null,
): string[] {
  return [...paths].sort((left, right) => {
    const leftId = parseId(nameOf(left));
    const rightId = parseId(nameOf(right));
    if (leftId !== null && rightId !== null && leftId !== rightId) {
      return leftId - rightId;
    }
    return left.localeCompare(right);
  });
}
