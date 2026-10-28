/**
 * The implementation of the project store that keeps the files in the browser.
 *
 * Everything is computed in the browser: the shell of the low level service is
 * not available here, so the listing, the hierarchy and the search are done in
 * JavaScript over the files of the project.
 *
 * Only **one** embedded project can live in a browser: the files of the project
 * are the content of the storage, and importing a ZIP archive replaces them.
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
import type { BrowserFileStorage } from './browserStorage.js';
import type { NoteSummary, ProjectFile, ProjectKind, ProjectStore, TaskSummary } from './projectStore.js';
import { APP_CONFIG_FILE } from './appConfig.js';

export class EmbeddedProjectStore implements ProjectStore {
  readonly kind: ProjectKind = 'embedded';
  private readonly storage: BrowserFileStorage;
  /** The files of the project, indexed by their path. */
  private readonly files = new Map<string, string>();

  constructor(storage: BrowserFileStorage) {
    this.storage = storage;
  }

  /** Reads every file of the project in memory. */
  async load(): Promise<void> {
    this.files.clear();
    for (const path of await this.storage.list()) {
      const content = await this.storage.read(path);
      if (content !== null) {
        this.files.set(path, content);
      }
    }
  }

  /**
   * The names of the files, without their content.
   *
   * The files are sorted by the id encoded in their name: the parser of the
   * ids changes for the notes and for the comments.
   */
  private pathsOf(
    predicate: (path: string) => boolean,
    parseId: (name: string) => number | null = parseTaskIdFromFileName,
  ): string[] {
    return [...this.files.keys()].filter(predicate).sort((left, right) => {
      const leftId = parseId(left.slice(left.lastIndexOf('/') + 1));
      const rightId = parseId(right.slice(right.lastIndexOf('/') + 1));
      if (leftId !== null && rightId !== null && leftId !== rightId) {
        return leftId - rightId;
      }
      return left.localeCompare(right);
    });
  }

  async listTasks(): Promise<readonly TaskSummary[]> {
    const summaries: TaskSummary[] = [];
    for (const path of this.pathsOf((name) => isTaskFileName(name.slice(name.lastIndexOf('/') + 1)))) {
      const content = this.files.get(path);
      if (content === undefined) {
        continue;
      }
      const task = parseTask(
        content,
        parseTaskIdFromFileName(path.slice(path.lastIndexOf('/') + 1)) ?? undefined,
      );
      summaries.push({
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
      });
    }
    return summaries;
  }

  async readTask(path: string): Promise<Task> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`The file "${path}" does not exist in the embedded project.`);
    }
    return parseTask(
      content,
      parseTaskIdFromFileName(path.slice(path.lastIndexOf('/') + 1)) ?? undefined,
    );
  }

  async writeTask(path: string, task: Task): Promise<void> {
    await this.write(path, serializeTask(task));
  }

  async createTaskFile(path: string, task: Task): Promise<void> {
    if (this.files.has(path)) {
      throw new Error(`The file "${path}" already exists in the embedded project.`);
    }
    await this.write(path, serializeTask(task));
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
    await this.storage.remove(path);
  }

  async readAppConfig(): Promise<string | null> {
    return this.files.get(APP_CONFIG_FILE) ?? null;
  }

  async writeAppConfig(content: string): Promise<void> {
    await this.write(APP_CONFIG_FILE, content);
  }

  async listTaskPaths(): Promise<readonly string[]> {
    return this.pathsOf((name) => isTaskFileName(name.slice(name.lastIndexOf('/') + 1)));
  }

  async searchTaskPaths(term: string): Promise<readonly string[]> {
    const needle = term.trim().toLowerCase();
    if (needle.length === 0) {
      return this.listTaskPaths();
    }
    const paths: string[] = [];
    for (const path of await this.listTaskPaths()) {
      const content = this.files.get(path);
      if (content !== undefined && content.toLowerCase().includes(needle)) {
        paths.push(path);
      }
    }
    return paths;
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
    for (const path of this.pathsOf((name) => isCommentFileName(name.slice(name.lastIndexOf('/') + 1)))) {
      const content = this.files.get(path);
      if (content === undefined) {
        continue;
      }
      const comment = parseComment(content, parseCommentIdFromFileName(path.slice(path.lastIndexOf('/') + 1)) ?? undefined);
      counts.set(comment.taskId, (counts.get(comment.taskId) ?? 0) + 1);
    }
    return counts;
  }

  async listComments(taskId: number): Promise<readonly TaskComment[]> {
    const comments: TaskComment[] = [];
    for (const path of this.pathsOf((name) => isCommentFileName(name.slice(name.lastIndexOf('/') + 1)))) {
      const content = this.files.get(path);
      if (content === undefined) {
        continue;
      }
      const comment = parseComment(
        content,
        parseCommentIdFromFileName(path.slice(path.lastIndexOf('/') + 1)) ?? undefined,
      );
      if (comment.taskId === taskId) {
        comments.push(comment);
      }
    }
    return sortComments(comments);
  }

  async createComment(taskId: number, text: string): Promise<TaskComment> {
    const id = await this.nextCommentId();
    const comment = buildComment(id, taskId, text, new Date());
    await this.write(this.commentPath(id), serializeComment(comment));
    return comment;
  }

  async writeComment(comment: TaskComment): Promise<void> {
    await this.write(this.commentPath(comment.id), serializeComment(comment));
  }

  async deleteComment(path: string): Promise<void> {
    this.files.delete(path);
    await this.storage.remove(path);
  }

  // --------------------------------------------------------------- notes --

  async listNotePaths(): Promise<readonly string[]> {
    return this.pathsOf(
      (path) => isNoteFileName(path.slice(path.lastIndexOf('/') + 1)),
      parseNoteIdFromFileName,
    );
  }

  async listNoteSummaries(): Promise<readonly NoteSummary[]> {
    const summaries: NoteSummary[] = [];
    for (const path of await this.listNotePaths()) {
      const content = this.files.get(path);
      if (content === undefined) {
        continue;
      }
      const note = parseNote(content, parseNoteIdFromFileName(path.slice(path.lastIndexOf('/') + 1)) ?? undefined);
      summaries.push({ id: note.id, title: note.title, updated: note.updated, path });
    }
    return summaries;
  }

  async searchNotePaths(term: string, scope: NoteSearchScope): Promise<readonly string[]> {
    const paths = await this.listNotePaths();
    const needle = term.trim();
    if (needle.length === 0) {
      return paths;
    }
    const matches: string[] = [];
    for (const path of paths) {
      const content = this.files.get(path);
      if (content === undefined) {
        continue;
      }
      const note = parseNote(content, parseNoteIdFromFileName(path.slice(path.lastIndexOf('/') + 1)) ?? undefined);
      if (noteMatches(note, needle, scope)) {
        matches.push(path);
      }
    }
    return matches;
  }

  async readNote(path: string): Promise<Note> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`The file "${path}" does not exist in the embedded project.`);
    }
    return parseNote(
      content,
      parseNoteIdFromFileName(path.slice(path.lastIndexOf('/') + 1)) ?? undefined,
    );
  }

  async writeNote(path: string, note: Note): Promise<void> {
    await this.write(path, serializeNote(note));
  }

  async createNoteFile(path: string, note: Note): Promise<void> {
    if (this.files.has(path)) {
      throw new Error(`The file "${path}" already exists in the embedded project.`);
    }
    await this.write(path, serializeNote(note));
  }

  async nextNoteId(): Promise<number> {
    const ids: number[] = [];
    for (const path of await this.listNotePaths()) {
      const id = parseNoteIdFromFileName(path.slice(path.lastIndexOf('/') + 1));
      if (id !== null) {
        ids.push(id);
      }
    }
    return ids.length === 0 ? 1 : Math.max(...ids) + 1;
  }

  notePath(id: number): string {
    return noteFileName(id);
  }

  async nextTaskId(): Promise<number> {
    const ids: number[] = [];
    for (const path of this.pathsOf((name) => isTaskFileName(name.slice(name.lastIndexOf('/') + 1)))) {
      const id = parseTaskIdFromFileName(path.slice(path.lastIndexOf('/') + 1));
      if (id !== null) {
        ids.push(id);
      }
    }
    return ids.length === 0 ? 1 : Math.max(...ids) + 1;
  }

  async nextCommentId(): Promise<number> {
    const ids: number[] = [];
    for (const path of this.pathsOf((name) => isCommentFileName(name.slice(name.lastIndexOf('/') + 1)))) {
      const id = parseCommentIdFromFileName(path.slice(path.lastIndexOf('/') + 1));
      if (id !== null) {
        ids.push(id);
      }
    }
    return ids.length === 0 ? 1 : Math.max(...ids) + 1;
  }

  taskPath(id: number): string {
    return taskFileName(id);
  }

  commentPath(id: number): string {
    return commentFileName(id);
  }

  async listFiles(): Promise<readonly ProjectFile[]> {
    await this.load();
    return [...this.files.entries()]
      .map(([path, content]) => ({ path, content }))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  async replaceAll(files: readonly ProjectFile[]): Promise<void> {
    await this.storage.clear();
    this.files.clear();
    for (const file of files) {
      await this.write(file.path, file.content);
    }
  }

  /** Writes a file, both in the memory and in the storage. */
  private async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    await this.storage.write(path, content);
  }
}
