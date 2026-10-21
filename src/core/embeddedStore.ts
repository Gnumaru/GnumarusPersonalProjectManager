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
import type { BrowserFileStorage } from './browserStorage.js';
import type { ProjectFile, ProjectKind, ProjectStore, TaskSummary } from './projectStore.js';

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

  /** The names of the files, without their content. */
  private pathsOf(predicate: (path: string) => boolean): string[] {
    return [...this.files.keys()].filter(predicate).sort((left, right) => {
      const leftId = parseTaskIdFromFileName(left.slice(left.lastIndexOf('/') + 1));
      const rightId = parseTaskIdFromFileName(right.slice(right.lastIndexOf('/') + 1));
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
