/**
 * The implementation of the project store that keeps the files in Supabase.
 *
 * Every file of the project is one row of a single `public.gnumarus_files`
 * table (`path` primary key, `content` text): the listing, the hierarchy and
 * the search are computed in JavaScript over those rows, exactly like the
 * embedded implementation, while the table itself is reached through the
 * PostgREST API of the Supabase project.
 */

import { ApiError } from '../api/client.js';
import { SupabaseClient } from '../api/supabase.js';
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
import { IDS_FILE, generateUniqueId, parseIdsFile, serializeIdsFile } from './ids.js';
import type { NoteSummary, ProjectFile, ProjectKind, ProjectStore, TaskSummary } from './projectStore.js';
import { APP_CONFIG_FILE } from './appConfig.js';

export class SupabaseProjectStore implements ProjectStore {
  readonly kind: ProjectKind = 'supabase';
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  /** The name of a file, without its folders. */
  private static nameOf(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
  }

  /** True when the error means the row does not exist. */
  private static isMissing(error: unknown): boolean {
    return error instanceof ApiError && error.status === 404;
  }

  async listTaskPaths(): Promise<readonly string[]> {
    return (await this.client.listPaths()).filter((path) =>
      isTaskFileName(SupabaseProjectStore.nameOf(path)),
    );
  }

  async searchTaskPaths(term: string): Promise<readonly string[]> {
    const needle = term.trim().toLowerCase();
    const paths = await this.listTaskPaths();
    if (needle.length === 0) {
      return paths;
    }
    const matches: string[] = [];
    for (const path of paths) {
      const content = await this.client.readRow(path).then(
        (row) => row?.content ?? null,
        (error: unknown) => {
          if (SupabaseProjectStore.isMissing(error)) {
            return null;
          }
          throw error;
        },
      );
      if (content !== null && content.toLowerCase().includes(needle)) {
        matches.push(path);
      }
    }
    return matches;
  }

  async listTasks(): Promise<readonly TaskSummary[]> {
    const summaries: TaskSummary[] = [];
    for (const row of await this.client.listRows()) {
      if (!isTaskFileName(SupabaseProjectStore.nameOf(row.path))) {
        continue;
      }
      const task = parseTask(
        row.content,
        parseTaskIdFromFileName(SupabaseProjectStore.nameOf(row.path)) ?? undefined,
      );
      summaries.push({
        id: task.id,
        title: task.title,
        status: task.status,
        parentId: task.parentId,
        tags: task.tags,
        type: task.type ?? 'Feature',
        role: task.role ?? 'Programming',
        start: task.start,
        end: task.end,
        updated: task.updated,
        expanded: task.expanded,
        kanbanHidden: task.kanbanHidden ?? false,
        treeGanttHidden: task.treeGanttHidden ?? false,
        kanbanOrder: task.kanbanOrder ?? 0,
        treeGanttOrder: task.treeGanttOrder ?? 0,
        path: row.path,
      });
    }
    return summaries;
  }

  async readTask(path: string): Promise<Task> {
    const row = await this.client.readRow(path);
    if (row === null) {
      throw new ApiError(`The file "${path}" does not exist in the Supabase project.`, 404);
    }
    return parseTask(
      row.content,
      parseTaskIdFromFileName(SupabaseProjectStore.nameOf(path)) ?? undefined,
    );
  }

  async writeTask(path: string, task: Task): Promise<void> {
    await this.client.upsertRow({ path, content: serializeTask(task) });
  }

  async createTaskFile(path: string, task: Task): Promise<void> {
    try {
      await this.client.insertRow({ path, content: serializeTask(task) });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        throw new Error(`The file "${path}" already exists in the Supabase project.`);
      }
      throw error;
    }
  }

  async deleteFile(path: string): Promise<void> {
    await this.client.deleteRow(path);
  }

  async readAppConfig(): Promise<string | null> {
    return (await this.client.readRow(APP_CONFIG_FILE))?.content ?? null;
  }

  async writeAppConfig(content: string): Promise<void> {
    await this.client.upsertRow({ path: APP_CONFIG_FILE, content });
  }

  /**
   * Allocates the id of a new record: a random nonzero integer used by
   * nothing yet, whatever the kind of record.
   *
   * The used ids live in a single `ids.txt` registry row, so allocation
   * reads that one row instead of scanning the whole table. The id is
   * reserved in the registry before it is returned (reserve-then-create),
   * and ids are never removed from it, not even when their record is
   * deleted, so an id is never reused.
   */
  async allocateId(): Promise<number> {
    const taken = await this.readTakenIds();
    const id = generateUniqueId((candidate) => taken.has(candidate));
    taken.add(id);
    await this.client.upsertRow({ path: IDS_FILE, content: serializeIdsFile(taken) });
    return id;
  }

  /** Every id used by the project, from the `ids.txt` registry row. */
  private async readTakenIds(): Promise<Set<number>> {
    const content = (await this.client.readRow(IDS_FILE))?.content ?? null;
    if (content !== null) {
      return parseIdsFile(content);
    }
    return this.bootstrapIdsFile();
  }

  /**
   * Builds the `ids.txt` registry from the record rows already stored.
   *
   * Runs once for projects created before the registry existed: every id
   * encoded in a `task_*.txt`, `comment_*.txt` or `note_*.txt` path is
   * registered, so a later allocation never reuses one.
   */
  private async bootstrapIdsFile(): Promise<Set<number>> {
    const taken = new Set<number>();
    for (const path of await this.client.listPaths()) {
      const name = SupabaseProjectStore.nameOf(path);
      const id =
        parseTaskIdFromFileName(name) ??
        parseCommentIdFromFileName(name) ??
        parseNoteIdFromFileName(name);
      if (id !== null) {
        taken.add(id);
      }
    }
    await this.client.upsertRow({ path: IDS_FILE, content: serializeIdsFile(taken) });
    return taken;
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
    for (const row of await this.client.listRows()) {
      const name = SupabaseProjectStore.nameOf(row.path);
      if (!isCommentFileName(name)) {
        continue;
      }
      const comment = parseComment(
        row.content,
        parseCommentIdFromFileName(name) ?? undefined,
      );
      counts.set(comment.taskId, (counts.get(comment.taskId) ?? 0) + 1);
    }
    return counts;
  }

  async listComments(taskId: number): Promise<readonly TaskComment[]> {
    const comments: TaskComment[] = [];
    for (const row of await this.client.listRows()) {
      const name = SupabaseProjectStore.nameOf(row.path);
      if (!isCommentFileName(name)) {
        continue;
      }
      const comment = parseComment(
        row.content,
        parseCommentIdFromFileName(name) ?? undefined,
      );
      if (comment.taskId === taskId) {
        comments.push(comment);
      }
    }
    return sortComments(comments);
  }

  async createComment(taskId: number, text: string): Promise<TaskComment> {
    const id = await this.allocateId();
    const comment = buildComment(id, taskId, text, new Date());
    try {
      await this.client.insertRow({ path: this.commentPath(id), content: serializeComment(comment) });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        throw new Error(`The file "${this.commentPath(id)}" already exists in the Supabase project.`);
      }
      throw error;
    }
    return comment;
  }

  async writeComment(comment: TaskComment): Promise<void> {
    await this.client.upsertRow({
      path: this.commentPath(comment.id),
      content: serializeComment(comment),
    });
  }

  async deleteComment(path: string): Promise<void> {
    await this.client.deleteRow(path);
  }

  // --------------------------------------------------------------- notes --

  async listNotePaths(): Promise<readonly string[]> {
    return (await this.client.listPaths()).filter((path) =>
      isNoteFileName(SupabaseProjectStore.nameOf(path)),
    );
  }

  async listNoteSummaries(): Promise<readonly NoteSummary[]> {
    const summaries: NoteSummary[] = [];
    for (const row of await this.client.listRows()) {
      const name = SupabaseProjectStore.nameOf(row.path);
      if (!isNoteFileName(name)) {
        continue;
      }
      const note = parseNote(row.content, parseNoteIdFromFileName(name) ?? undefined);
      summaries.push({ id: note.id, title: note.title, updated: note.updated, path: row.path });
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
      const row = await this.client.readRow(path).catch((error: unknown) => {
        if (SupabaseProjectStore.isMissing(error)) {
          return null;
        }
        throw error;
      });
      if (row === null) {
        continue;
      }
      const note = parseNote(
        row.content,
        parseNoteIdFromFileName(SupabaseProjectStore.nameOf(path)) ?? undefined,
      );
      if (noteMatches(note, needle, scope)) {
        matches.push(path);
      }
    }
    return matches;
  }

  async readNote(path: string): Promise<Note> {
    const row = await this.client.readRow(path);
    if (row === null) {
      throw new ApiError(`The file "${path}" does not exist in the Supabase project.`, 404);
    }
    return parseNote(
      row.content,
      parseNoteIdFromFileName(SupabaseProjectStore.nameOf(path)) ?? undefined,
    );
  }

  async writeNote(path: string, note: Note): Promise<void> {
    await this.client.upsertRow({ path, content: serializeNote(note) });
  }

  async createNoteFile(path: string, note: Note): Promise<void> {
    try {
      await this.client.insertRow({ path, content: serializeNote(note) });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        throw new Error(`The file "${path}" already exists in the Supabase project.`);
      }
      throw error;
    }
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

  async listFiles(): Promise<readonly ProjectFile[]> {
    return (await this.client.listRows())
      .map((row) => ({ path: row.path, content: row.content }))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  async replaceAll(files: readonly ProjectFile[]): Promise<void> {
    for (const path of await this.client.listPaths()) {
      await this.client.deleteRow(path);
    }
    for (const file of files) {
      await this.client.upsertRow({ path: file.path, content: file.content });
    }
    // The import replaces the whole project: rebuild the registry from the
    // imported files, keeping the previously registered ids (an id is never
    // reused, even when its record is gone).
    const taken = new Set<number>();
    for (const file of files) {
      const name = SupabaseProjectStore.nameOf(file.path);
      if (name === IDS_FILE) {
        for (const id of parseIdsFile(file.content)) {
          taken.add(id);
        }
        continue;
      }
      const id =
        parseTaskIdFromFileName(name) ??
        parseCommentIdFromFileName(name) ??
        parseNoteIdFromFileName(name);
      if (id !== null) {
        taken.add(id);
      }
    }
    await this.client.upsertRow({ path: IDS_FILE, content: serializeIdsFile(taken) });
  }
}
