/**
 * The implementation of the project store that keeps the records in Supabase.
 *
 * Every record is one row of a normalized table (`tasks`, `comments`,
 * `notes`, a key/value `config` table and an `ids` registry table), reached
 * through the PostgREST API of the Supabase project. File paths are virtual
 * identifiers (`task_<id>.txt` and friends): the project has no subfolders,
 * and the ZIP export and import translate through the same file format as
 * every other backend.
 */

import { ApiError } from '../api/client.js';
import { SupabaseClient, type SupabaseRow, type SupabaseTable } from '../api/supabase.js';
import {
  buildComment,
  commentFileName,
  parseComment,
  serializeComment,
  sortComments,
  type TaskComment,
} from './comment.js';
import {
  isTaskRole,
  isTaskStatus,
  isTaskType,
  normalizeTags,
  normalizeTaskTimestamp,
  parseIdList,
  parseMetadataBlock,
  parseTask,
  serializeTask,
  taskFileName,
  type Task,
} from './task.js';
import {
  noteFileName,
  noteMatches,
  parseNote,
  serializeNote,
  type Note,
  type NoteSearchScope,
} from './note.js';
import {
  IDS_FILE,
  MAX_ID_ATTEMPTS,
  isValidRecordId,
  parseIdsFile,
  randomCandidateId,
  serializeIdsFile,
} from './ids.js';
import type { NoteSummary, ProjectFile, ProjectKind, ProjectStore, TaskSummary } from './projectStore.js';
import { APP_CONFIG_FILE } from './appConfig.js';

/** All columns of the tasks table, for the full reads. */
const TASK_COLUMNS = [
  'id',
  'title',
  'status',
  'parent',
  'tags',
  'created',
  'updated',
  'start',
  'end',
  'blocked_by',
  'related',
  'expanded',
  'type',
  'role',
  'kanban_hidden',
  'tree_gantt_hidden',
  'kanban_order',
  'tree_gantt_order',
  'description',
] as const;

/** All columns of the comments table. */
const COMMENT_COLUMNS = ['id', 'task', 'created', 'updated', 'body'] as const;

/** All columns of the notes table. */
const NOTE_COLUMNS = ['id', 'title', 'created', 'updated', 'body'] as const;

function textOf(row: SupabaseRow, column: string, fallback = ''): string {
  const value = row[column];
  return typeof value === 'string' ? value : fallback;
}

function booleanOf(row: SupabaseRow, column: string): boolean {
  return row[column] === true;
}

function orderOf(row: SupabaseRow, column: string): number {
  const value = row[column];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function idOf(value: SupabaseValueOfRow): number | null {
  return typeof value === 'number' && isValidRecordId(value) ? value : null;
}

type SupabaseValueOfRow = string | number | boolean | null | undefined;

/**
 * Reads a date cell as a compact timestamp.
 *
 * Accepts the PostgreSQL `timestamp` output (`YYYY-MM-DD HH:MI:SS` with
 * optional fractional seconds), the compact format and the legacy ISO
 * format, so rows written before the timestamp columns keep working.
 * Unknown dates become an empty string.
 */
export function parseDatabaseTimestamp(value: SupabaseValueOfRow): string {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '';
  }
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/u.exec(trimmed);
  if (match !== null) {
    const fraction = `${match[7] ?? ''}000`.slice(0, 3);
    return normalizeTaskTimestamp(
      `${match[1] ?? ''}${match[2] ?? ''}${match[3] ?? ''}${match[4] ?? ''}${match[5] ?? ''}${match[6] ?? ''}${fraction}`,
    );
  }
  return normalizeTaskTimestamp(trimmed);
}

/**
 * Writes a compact timestamp as a database value: a PostgreSQL timestamp
 * literal, or null for an unknown date.
 */
export function databaseTimestampValue(compact: string): string | null {
  const trimmed = compact.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})$/.exec(trimmed);
  if (match === null) {
    return trimmed;
  }
  return `${match[1] ?? ''}-${match[2] ?? ''}-${match[3] ?? ''} ${match[4] ?? ''}:${match[5] ?? ''}:${match[6] ?? ''}.${match[7] ?? ''}`;
}

/** A task row as the summary the tree, the board and the chart need. */
function rowToSummary(row: SupabaseRow, path: string): TaskSummary | null {
  const id = idOf(row['id']);
  if (id === null) {
    return null;
  }
  const rawStatus = textOf(row, 'status');
  const rawType = textOf(row, 'type');
  const rawRole = textOf(row, 'role');
  return {
    id,
    title: textOf(row, 'title'),
    status: isTaskStatus(rawStatus) ? rawStatus : 'todo',
    parentId: idOf(row['parent']),
    tags: normalizeTags(textOf(row, 'tags')),
    type: isTaskType(rawType) ? rawType : 'Feature',
    role: isTaskRole(rawRole) ? rawRole : 'Programming',
    start: parseDatabaseTimestamp(row['start']),
    end: parseDatabaseTimestamp(row['end']),
    updated: parseDatabaseTimestamp(row['updated']),
    expanded: booleanOf(row, 'expanded'),
    kanbanHidden: booleanOf(row, 'kanban_hidden'),
    treeGanttHidden: booleanOf(row, 'tree_gantt_hidden'),
    kanbanOrder: orderOf(row, 'kanban_order'),
    treeGanttOrder: orderOf(row, 'tree_gantt_order'),
    path,
  };
}

/** A task row as a full task. */
function rowToTask(row: SupabaseRow): Task | null {
  const summary = rowToSummary(row, '');
  if (summary === null) {
    return null;
  }
  return {
    id: summary.id,
    title: summary.title,
    status: summary.status,
    parentId: summary.parentId,
    tags: summary.tags,
    created: parseDatabaseTimestamp(row['created']),
    updated: summary.updated,
    start: summary.start,
    end: summary.end,
    blockedBy: parseIdList(textOf(row, 'blocked_by')),
    related: parseIdList(textOf(row, 'related')),
    expanded: summary.expanded,
    type: summary.type,
    role: summary.role,
    kanbanHidden: summary.kanbanHidden,
    treeGanttHidden: summary.treeGanttHidden,
    kanbanOrder: summary.kanbanOrder,
    treeGanttOrder: summary.treeGanttOrder,
    description: textOf(row, 'description'),
  };
}

/** A full task as a task row. */
function taskToRow(task: Task): SupabaseRow {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    parent: task.parentId,
    tags: task.tags.join(' '),
    created: databaseTimestampValue(task.created),
    updated: databaseTimestampValue(task.updated),
    start: databaseTimestampValue(task.start),
    end: databaseTimestampValue(task.end),
    blocked_by: task.blockedBy.join(','),
    related: task.related.join(','),
    expanded: task.expanded,
    type: task.type ?? 'Feature',
    role: task.role ?? 'Programming',
    kanban_hidden: task.kanbanHidden ?? false,
    tree_gantt_hidden: task.treeGanttHidden ?? false,
    kanban_order: task.kanbanOrder ?? 0,
    tree_gantt_order: task.treeGanttOrder ?? 0,
    description: task.description,
  };
}

/** A comment row as a full comment. */
function rowToComment(row: SupabaseRow): TaskComment | null {
  const id = idOf(row['id']);
  if (id === null) {
    return null;
  }
  return {
    id,
    taskId: idOf(row['task']) ?? 0,
    created: parseDatabaseTimestamp(row['created']),
    updated: parseDatabaseTimestamp(row['updated']),
    text: textOf(row, 'body'),
  };
}

/** A note row as a full note. */
function rowToNote(row: SupabaseRow): Note | null {
  const id = idOf(row['id']);
  if (id === null) {
    return null;
  }
  return {
    id,
    title: textOf(row, 'title'),
    created: parseDatabaseTimestamp(row['created']),
    updated: parseDatabaseTimestamp(row['updated']),
    content: textOf(row, 'body'),
  };
}

export class SupabaseProjectStore implements ProjectStore {
  readonly kind: ProjectKind = 'supabase';
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  /** The virtual path of a task row. */
  private static taskPathOf(id: number): string {
    return taskFileName(id);
  }

  private async selectTaskRows(): Promise<SupabaseRow[]> {
    return this.client.selectRows('tasks', { select: [...TASK_COLUMNS], order: 'id' });
  }

  async listTaskPaths(): Promise<readonly string[]> {
    const rows = await this.client.selectRows('tasks', { select: ['id'], order: 'id' });
    const paths: string[] = [];
    for (const row of rows) {
      const id = idOf(row['id']);
      if (id !== null) {
        paths.push(SupabaseProjectStore.taskPathOf(id));
      }
    }
    return paths.sort((left, right) => left.localeCompare(right));
  }

  async searchTaskPaths(term: string): Promise<readonly string[]> {
    const needle = term.trim().toLowerCase();
    const rows = await this.client.selectRows('tasks', {
      select: ['id', 'title', 'tags', 'description'],
      order: 'id',
    });
    const matches: string[] = [];
    for (const row of rows) {
      const id = idOf(row['id']);
      if (id === null) {
        continue;
      }
      if (needle.length === 0) {
        matches.push(SupabaseProjectStore.taskPathOf(id));
        continue;
      }
      const haystack = [textOf(row, 'title'), textOf(row, 'tags'), textOf(row, 'description')]
        .join('\n')
        .toLowerCase();
      if (haystack.includes(needle)) {
        matches.push(SupabaseProjectStore.taskPathOf(id));
      }
    }
    return matches.sort((left, right) => left.localeCompare(right));
  }

  async listTasks(): Promise<readonly TaskSummary[]> {
    const summaries: TaskSummary[] = [];
    for (const row of await this.selectTaskRows()) {
      const summary = rowToSummary(row, '');
      if (summary !== null) {
        summaries.push({ ...summary, path: SupabaseProjectStore.taskPathOf(summary.id) });
      }
    }
    return summaries;
  }

  async readTask(path: string): Promise<Task> {
    const id = SupabaseProjectStore.idOfTaskPath(path);
    const rows =
      id === null
        ? []
        : await this.client.selectRows('tasks', {
            select: [...TASK_COLUMNS],
            filter: { column: 'id', value: id },
          });
    const task = rows.length > 0 && rows[0] !== undefined ? rowToTask(rows[0]) : null;
    if (task === null) {
      throw new ApiError(`The task "${path}" does not exist in the Supabase project.`, 404);
    }
    return task;
  }

  /** The id encoded in a virtual task path, `null` when invalid. */
  private static idOfTaskPath(path: string): number | null {
    const match = /task_(-?\d+)\.txt$/.exec(path.slice(path.lastIndexOf('/') + 1));
    if (match === null) {
      return null;
    }
    const id = Number.parseInt(match[1] ?? '', 10);
    return isValidRecordId(id) ? id : null;
  }

  async writeTask(_path: string, task: Task): Promise<void> {
    await this.client.upsertRows('tasks', [taskToRow(task)]);
  }

  async createTaskFile(_path: string, task: Task): Promise<void> {
    try {
      await this.client.insertRows('tasks', [taskToRow(task)]);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        throw new Error(`The task #${task.id} already exists in the Supabase project.`);
      }
      throw error;
    }
  }

  async deleteFile(path: string): Promise<void> {
    // Paths are virtual identifiers: the record kind comes from the name.
    const name = path.slice(path.lastIndexOf('/') + 1);
    for (const table of ['tasks', 'comments', 'notes'] as const) {
      const id = SupabaseProjectStore.idOfName(table, name);
      if (id !== null) {
        await this.client.deleteRows(table, { column: 'id', value: id });
        return;
      }
    }
  }

  /** The id encoded in a record file name of the table, `null` otherwise. */
  private static idOfName(table: SupabaseTable, name: string): number | null {
    const patterns: Readonly<Record<SupabaseTable, RegExp>> = {
      tasks: /^task_(-?\d+)\.txt$/,
      comments: /^comment_(-?\d+)\.txt$/,
      notes: /^note_(-?\d+)\.txt$/,
      config: /^$/,
      ids: /^$/,
    };
    const match = patterns[table].exec(name);
    if (match === null) {
      return null;
    }
    const id = Number.parseInt(match[1] ?? '', 10);
    return isValidRecordId(id) ? id : null;
  }

  async readAppConfig(): Promise<string | null> {
    const rows = await this.client.selectRows('config', { select: ['key', 'value'], order: 'key' });
    if (rows.length === 0) {
      return null;
    }
    const lines: string[] = [];
    for (const row of rows) {
      if (typeof row['key'] === 'string') {
        lines.push(`${row['key']}=${textOf(row, 'value')}`);
      }
    }
    return lines.length === 0 ? null : `${lines.join('\n')}\n`;
  }

  async writeAppConfig(content: string): Promise<void> {
    const { metadata } = parseMetadataBlock(content);
    for (const row of await this.client.selectRows('config', { select: ['key'] })) {
      if (typeof row['key'] === 'string') {
        await this.client.deleteRows('config', { column: 'key', value: row['key'] });
      }
    }
    if (metadata.size > 0) {
      await this.client.insertRows(
        'config',
        [...metadata.entries()].map(([key, value]) => ({ key, value })),
      );
    }
  }

  /**
   * Allocates the id of a new record: a random nonzero integer used by
   * nothing yet, whatever the kind of record.
   *
   * The `ids` table is the registry: the id is inserted before it is
   * returned, so the primary key itself rejects a duplicate and allocation
   * retries with a new random id. Ids are never removed, not even when their
   * record is deleted, so an id is never reused.
   */
  async allocateId(): Promise<number> {
    await this.readTakenIds();
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
      const id = randomCandidateId();
      try {
        await this.client.insertRows('ids', [{ id }]);
        return id;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          continue;
        }
        throw error;
      }
    }
    throw new Error('Unable to allocate a free id');
  }

  /** Every id used by the project, registering the existing records once. */
  private async readTakenIds(): Promise<Set<number>> {
    const taken = new Set<number>();
    for (const row of await this.client.selectRows('ids', { select: ['id'] })) {
      const id = idOf(row['id']);
      if (id !== null) {
        taken.add(id);
      }
    }
    if (taken.size > 0) {
      return taken;
    }
    // Empty registry with existing records: register them once, so a later
    // allocation never reuses one.
    let bootstrapped = false;
    for (const table of ['tasks', 'comments', 'notes'] as const) {
      for (const row of await this.client.selectRows(table, { select: ['id'] })) {
        const id = idOf(row['id']);
        if (id !== null && !taken.has(id)) {
          taken.add(id);
          bootstrapped = true;
        }
      }
    }
    if (bootstrapped) {
      await this.client.insertRows(
        'ids',
        [...taken].map((id) => ({ id })),
      );
    }
    return taken;
  }

  async childCounts(): Promise<ReadonlyMap<number, number>> {
    const counts = new Map<number, number>();
    for (const row of await this.client.selectRows('tasks', { select: ['parent'] })) {
      const parentId = idOf(row['parent']);
      if (parentId !== null) {
        counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
      }
    }
    return counts;
  }

  async commentCounts(): Promise<ReadonlyMap<number, number>> {
    const counts = new Map<number, number>();
    for (const row of await this.client.selectRows('comments', { select: ['task'] })) {
      const taskId = idOf(row['task']);
      if (taskId !== null) {
        counts.set(taskId, (counts.get(taskId) ?? 0) + 1);
      }
    }
    return counts;
  }

  async listComments(taskId: number): Promise<readonly TaskComment[]> {
    const comments: TaskComment[] = [];
    for (const row of await this.client.selectRows('comments', {
      select: [...COMMENT_COLUMNS],
      filter: { column: 'task', value: taskId },
    })) {
      const comment = rowToComment(row);
      if (comment !== null) {
        comments.push(comment);
      }
    }
    return sortComments(comments);
  }

  async createComment(taskId: number, text: string): Promise<TaskComment> {
    const id = await this.allocateId();
    const comment = buildComment(id, taskId, text, new Date());
    try {
      await this.client.insertRows('comments', [
        {
          id: comment.id,
          task: comment.taskId,
          created: databaseTimestampValue(comment.created),
          updated: databaseTimestampValue(comment.updated),
          body: comment.text,
        },
      ]);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        throw new Error(`The comment #${comment.id} already exists in the Supabase project.`);
      }
      throw error;
    }
    return comment;
  }

  async writeComment(comment: TaskComment): Promise<void> {
    await this.client.upsertRows('comments', [
      {
        id: comment.id,
        task: comment.taskId,
        created: databaseTimestampValue(comment.created),
        updated: databaseTimestampValue(comment.updated),
        body: comment.text,
      },
    ]);
  }

  async deleteComment(path: string): Promise<void> {
    const id = SupabaseProjectStore.idOfName('comments', path.slice(path.lastIndexOf('/') + 1));
    if (id !== null) {
      await this.client.deleteRows('comments', { column: 'id', value: id });
    }
  }

  // --------------------------------------------------------------- notes --

  async listNotePaths(): Promise<readonly string[]> {
    const rows = await this.client.selectRows('notes', { select: ['id'], order: 'id' });
    const paths: string[] = [];
    for (const row of rows) {
      const id = idOf(row['id']);
      if (id !== null) {
        paths.push(noteFileName(id));
      }
    }
    return paths.sort((left, right) => left.localeCompare(right));
  }

  async listNoteSummaries(): Promise<readonly NoteSummary[]> {
    const summaries: NoteSummary[] = [];
    for (const row of await this.client.selectRows('notes', {
      select: ['id', 'title', 'updated'],
      order: 'id',
    })) {
      const id = idOf(row['id']);
      if (id === null) {
        continue;
      }
      summaries.push({
        id,
        title: textOf(row, 'title'),
        updated: parseDatabaseTimestamp(row['updated']),
        path: noteFileName(id),
      });
    }
    return summaries;
  }

  async searchNotePaths(term: string, scope: NoteSearchScope): Promise<readonly string[]> {
    const rows = await this.client.selectRows('notes', { select: ['id', 'title', 'body'], order: 'id' });
    const needle = term.trim();
    if (needle.length === 0) {
      return this.listNotePaths();
    }
    const matches: string[] = [];
    for (const row of rows) {
      const id = idOf(row['id']);
      if (id === null) {
        continue;
      }
      const note = rowToNote({ ...row, created: '', updated: '' });
      if (note !== null && noteMatches(note, needle, scope)) {
        matches.push(noteFileName(id));
      }
    }
    return matches.sort((left, right) => left.localeCompare(right));
  }

  async readNote(path: string): Promise<Note> {
    const id = SupabaseProjectStore.idOfName('notes', path.slice(path.lastIndexOf('/') + 1));
    const rows =
      id === null
        ? []
        : await this.client.selectRows('notes', {
            select: [...NOTE_COLUMNS],
            filter: { column: 'id', value: id },
          });
    const note = rows.length > 0 && rows[0] !== undefined ? rowToNote(rows[0]) : null;
    if (note === null) {
      throw new ApiError(`The note "${path}" does not exist in the Supabase project.`, 404);
    }
    return note;
  }

  async writeNote(_path: string, note: Note): Promise<void> {
    await this.client.upsertRows('notes', [
      {
        id: note.id,
        title: note.title,
        created: databaseTimestampValue(note.created),
        updated: databaseTimestampValue(note.updated),
        body: note.content,
      },
    ]);
  }

  async createNoteFile(_path: string, note: Note): Promise<void> {
    try {
      await this.client.insertRows('notes', [
        {
          id: note.id,
          title: note.title,
          created: databaseTimestampValue(note.created),
          updated: databaseTimestampValue(note.updated),
          body: note.content,
        },
      ]);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        throw new Error(`The note #${note.id} already exists in the Supabase project.`);
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
    const files: ProjectFile[] = [];
    for (const row of await this.client.selectRows('tasks', { select: [...TASK_COLUMNS] })) {
      const task = rowToTask(row);
      if (task !== null) {
        files.push({ path: taskFileName(task.id), content: serializeTask(task) });
      }
    }
    for (const row of await this.client.selectRows('comments', { select: [...COMMENT_COLUMNS] })) {
      const comment = rowToComment(row);
      if (comment !== null) {
        files.push({
          path: commentFileName(comment.id),
          content: serializeComment(comment),
        });
      }
    }
    for (const row of await this.client.selectRows('notes', { select: [...NOTE_COLUMNS] })) {
      const note = rowToNote(row);
      if (note !== null) {
        files.push({ path: noteFileName(note.id), content: serializeNote(note) });
      }
    }
    const config = await this.readAppConfig();
    if (config !== null) {
      files.push({ path: APP_CONFIG_FILE, content: config });
    }
    const taken = await this.readTakenIds();
    if (taken.size > 0) {
      files.push({ path: IDS_FILE, content: serializeIdsFile(taken) });
    }
    return files.sort((left, right) => left.path.localeCompare(right.path));
  }

  async replaceAll(files: readonly ProjectFile[]): Promise<void> {
    for (const table of ['tasks', 'comments', 'notes', 'config', 'ids'] as const) {
      const key = table === 'config' ? 'key' : 'id';
      for (const row of await this.client.selectRows(table, { select: [key] })) {
        const value = row[key];
        if (typeof value === 'string' || typeof value === 'number') {
          await this.client.deleteRows(table, { column: key, value });
        }
      }
    }
    const taken = new Set<number>();
    for (const file of files) {
      const name = file.path.slice(file.path.lastIndexOf('/') + 1);
      if (name === IDS_FILE) {
        for (const id of parseIdsFile(file.content)) {
          taken.add(id);
        }
        continue;
      }
      if (name === APP_CONFIG_FILE) {
        const { metadata } = parseMetadataBlock(file.content);
        if (metadata.size > 0) {
          await this.client.insertRows(
            'config',
            [...metadata.entries()].map(([key, value]) => ({ key, value })),
          );
        }
        continue;
      }
      const taskId = SupabaseProjectStore.idOfName('tasks', name);
      if (taskId !== null) {
        const task = parseTask(file.content, taskId);
        await this.client.insertRows('tasks', [taskToRow(task)]);
        taken.add(task.id);
        continue;
      }
      const commentId = SupabaseProjectStore.idOfName('comments', name);
      if (commentId !== null) {
        const comment = parseComment(file.content, commentId);
        await this.client.insertRows('comments', [
          {
            id: comment.id,
            task: comment.taskId,
            created: databaseTimestampValue(comment.created),
            updated: databaseTimestampValue(comment.updated),
            body: comment.text,
          },
        ]);
        taken.add(comment.id);
        continue;
      }
      const noteId = SupabaseProjectStore.idOfName('notes', name);
      if (noteId !== null) {
        const note = parseNote(file.content, noteId);
        await this.client.insertRows('notes', [
          {
            id: note.id,
            title: note.title,
            created: databaseTimestampValue(note.created),
            updated: databaseTimestampValue(note.updated),
            body: note.content,
          },
        ]);
        taken.add(note.id);
      }
    }
    if (taken.size > 0) {
      await this.client.insertRows(
        'ids',
        [...taken].map((id) => ({ id })),
      );
    }
  }
}
