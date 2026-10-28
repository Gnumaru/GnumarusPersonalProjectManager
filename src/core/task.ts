/**
 * Task file format.
 *
 * A task is a plain text file named `task_<id>.txt`:
 *
 * ```
 * id=12
 * title=Implement pagination
 * status=todo
 * tags=frontend ui
 * created=20261020220000000
 * updated=20261020220000000
 * start=
 * end=
 * ----
 * Free text description.
 * ```
 *
 * The file starts with a metadata block made of `key=value` lines (like an `.ini`
 * file). The block is terminated by a line containing exactly four hyphens.
 * Everything after that line is the description.
 *
 * The dates are written in the compact format `YYYYMMDDHHNNSSIII` (year,
 * month, day, hour, minute, second and millisecond). The time is the local
 * time of the machine: **no timezone is stored**.
 *
 * Root tasks (the ones without a parent) simply have no `parent` key.
 *
 * A task can also carry an `expanded=true` key: it is the **view preference** of
 * the tree view (the Gantt chart reads it as well, and every other view ignores
 * it). It is written only when the branch of the task is shown expanded: the
 * key is simply removed when the branch is collapsed. Updating it does not
 * change the `updated` timestamp: it is not a change of the task content.
 */

export const METADATA_SEPARATOR = '----';
export const TASK_FILE_PREFIX = 'task_';
export const TASK_FILE_SUFFIX = '.txt';
export const TASK_FILE_PATTERN = /^task_(\d+)\.txt$/;

export const TASK_STATUSES = [
  'planning',
  'next',
  'todo',
  'doing',
  'paused',
  'done',
  'canceled',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

/** The name of every status, as it is shown to the user. */
export const STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  planning: 'PLANNING',
  next: 'NEXT',
  todo: 'TODO',
  doing: 'DOING',
  paused: 'PAUSED',
  done: 'DONE',
  canceled: 'CANCELED',
};

/**
 * The columns of the board, in the order they are shown.
 *
 * It is not the order of the statuses in the editor: the board starts with
 * the tasks that are not started yet.
 */
export const BOARD_STATUSES: readonly TaskStatus[] = [
  'planning',
  'todo',
  'next',
  'paused',
  'doing',
  'done',
  'canceled',
];

/** A task of the board: everything a card needs, and nothing more. */
export interface TaskCard {
  readonly id: number;
  readonly title: string;
  readonly status: TaskStatus;
  /** `null` for a task without parent. */
  readonly parentId: number | null;
  readonly tags: readonly string[];
  /** Whether the card is hidden on the board. */
  readonly kanbanHidden: boolean;
  /** Path of the file of the task. */
  readonly path: string;
}

export const TASK_TYPES = ['Bug', 'Improvement', 'Feature'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_ROLES = [
  'Graphics',
  'Audio',
  'Programming',
  'Design',
  'Assembly',
  'Management',
  'Test',
] as const;
export type TaskRole = (typeof TASK_ROLES)[number];

export function isTaskType(value: string): value is TaskType {
  return (TASK_TYPES as readonly string[]).includes(value);
}

export function isTaskRole(value: string): value is TaskRole {
  return (TASK_ROLES as readonly string[]).includes(value);
}

export interface Task {
  /** Unique incremental integer, also encoded in the file name. */
  readonly id: number;
  readonly title: string;
  readonly status: TaskStatus;
  /** `null` for a root task. */
  readonly parentId: number | null;
  readonly tags: readonly string[];
  /** Creation timestamp in the compact format, empty when unknown. */
  readonly created: string;
  /** Timestamp of the last update in the compact format, empty when unknown. */
  readonly updated: string;
  /** Timestamp of the start of the task, empty when it has not started. */
  readonly start: string;
  /** Timestamp of the end of the task, empty when it is not finished. */
  readonly end: string;
  /** The ids of the tasks that block this one: they prevent its completion. */
  readonly blockedBy: readonly number[];
  /** The ids of the tasks that are related to this one. */
  readonly related: readonly number[];
  /**
   * Whether the branch of the task is expanded in the tree view.
   *
   * It is a view preference, not a part of the task content: only the tree and
   * the Gantt views read it.
   */
  readonly expanded: boolean;
  /** The kind of work the task represents. */
  readonly type?: TaskType;
  /** The role responsible for the task. */
  readonly role?: TaskRole;
  /**
   * Whether the task is hidden on the Kanban board.
   *
   * It is a view preference, like `expanded`: only the board reads it.
   */
  readonly kanbanHidden?: boolean;
  /**
   * Whether the task is hidden in the tree view and the Gantt chart.
   *
   * It is a view preference, like `expanded`: only the tree and the Gantt
   * read it.
   */
  readonly treeGanttHidden?: boolean;
  /**
   * Order of the task among its siblings in the Kanban view.
   *
   * It is a view preference, not a part of the task content in the strict
   * sense, but it is persisted in the file. The smaller the number, the
   * higher the card sits in its column.
   */
  readonly kanbanOrder?: number;
  /**
   * Order of the task among its siblings in the tree view and in the Gantt
   * chart. The two views share the same order.
   */
  readonly treeGanttOrder?: number;
  readonly description: string;
}

export interface TaskInput {
  readonly title: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly tags: readonly string[];
  /** Start of the task, in the compact format, empty when it has not started. */
  readonly start: string;
  /** End of the task, in the compact format, empty when it is not finished. */
  readonly end: string;
  /** The ids of the tasks that block this one. */
  readonly blockedBy: readonly number[];
  /** The ids of the tasks that are related to this one. */
  readonly related: readonly number[];
  /** The parent of the task, when the editor changes it. */
  readonly parentId?: number | null;
  /** The kind of work the task represents. */
  readonly type?: TaskType;
  /** The role responsible for the task. */
  readonly role?: TaskRole;
}

export const EMPTY_TASK_INPUT: TaskInput = {
  title: '',
  description: '',
  status: 'todo',
  tags: [],
  start: '',
  end: '',
  blockedBy: [],
  related: [],
  type: 'Feature',
  role: 'Programming',
};

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

/**
 * The statuses shown dimmed in the tree view and the Gantt chart.
 *
 * Tasks that are still planning, already done or canceled look transparent,
 * like the hidden tasks.
 */
export const DIMMED_STATUSES: readonly TaskStatus[] = ['planning', 'done', 'canceled'];

/** True when rows of the task look dimmed in the tree view and the Gantt chart. */
export function isDimmedStatus(status: TaskStatus): boolean {
  return (DIMMED_STATUSES as readonly string[]).includes(status);
}

/** Amount of characters of a compact timestamp: `YYYYMMDDHHNNSSIII`. */
export const TIMESTAMP_LENGTH = 17;

/**
 * Formats a date as `YYYYMMDDHHNNSSIII`.
 *
 * The date is the **local** date of the machine: the compact format carries no
 * timezone, so the same moment is written differently on two machines.
 */
export function formatTaskTimestamp(date: Date): string {
  const pad = (value: number, length: number): string =>
    String(value).padStart(length, '0');
  return [
    pad(date.getFullYear(), 4),
    pad(date.getMonth() + 1, 2),
    pad(date.getDate(), 2),
    pad(date.getHours(), 2),
    pad(date.getMinutes(), 2),
    pad(date.getSeconds(), 2),
    pad(date.getMilliseconds(), 3),
  ].join('');
}

/**
 * Reads a timestamp written in the compact format.
 *
 * The ISO 8601 format of the tasks written before the change is still
 * accepted, so their dates are not lost; they are written back in the compact
 * format the next time the task is saved.
 */
export function parseTaskTimestamp(value: string): Date | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length === TIMESTAMP_LENGTH && /^\d{17}$/u.test(trimmed)) {
    const year = Number.parseInt(trimmed.slice(0, 4), 10);
    const month = Number.parseInt(trimmed.slice(4, 6), 10);
    const day = Number.parseInt(trimmed.slice(6, 8), 10);
    const hours = Number.parseInt(trimmed.slice(8, 10), 10);
    const minutes = Number.parseInt(trimmed.slice(10, 12), 10);
    const seconds = Number.parseInt(trimmed.slice(12, 14), 10);
    const milliseconds = Number.parseInt(trimmed.slice(14, 17), 10);
    const date = new Date(year, month - 1, day, hours, minutes, seconds, milliseconds);
    const valid =
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day &&
      date.getHours() === hours &&
      date.getMinutes() === minutes &&
      date.getSeconds() === seconds;
    return valid ? date : null;
  }
  const legacy = new Date(trimmed);
  return Number.isNaN(legacy.getTime()) ? null : legacy;
}

/**
 * Normalizes a timestamp to the compact format.
 *
 * An unknown or invalid value becomes an empty string.
 */
export function normalizeTaskTimestamp(value: string): string {
  const date = parseTaskTimestamp(value);
  return date === null ? '' : formatTaskTimestamp(date);
}

/**
 * The value of a date picker (`YYYY-MM-DD`) for a compact timestamp.
 *
 * An empty string when the task has no date.
 */
export function dateInputValue(timestamp: string): string {
  const date = parseTaskTimestamp(timestamp);
  if (date === null) {
    return '';
  }
  return dateInputValueOfDate(date);
}

/** The value of a date picker (`YYYY-MM-DD`) for a local date. */
export function dateInputValueOfDate(date: Date): string {
  const pad = (value: number, length = 2): string => String(value).padStart(length, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The compact timestamp of a date chosen in a date picker.
 *
 * The time is midnight. An empty string when the picker is empty or when the
 * date does not exist.
 */
export function timestampFromDateInput(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '';
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(trimmed);
  if (match === null) {
    return '';
  }
  const year = Number.parseInt(match[1] ?? '', 10);
  const month = Number.parseInt(match[2] ?? '', 10);
  const day = Number.parseInt(match[3] ?? '', 10);
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  const valid =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return valid ? formatTaskTimestamp(date) : '';
}

/** `task_12.txt` for the id `12`. */
export function taskFileName(id: number): string {
  return `${TASK_FILE_PREFIX}${id}${TASK_FILE_SUFFIX}`;
}

/** True when the file name follows the `task_<id>.txt` convention. */
export function isTaskFileName(name: string): boolean {
  return TASK_FILE_PATTERN.test(name);
}

/** Extracts the id encoded in a `task_<id>.txt` file name, `null` when invalid. */
export function parseTaskIdFromFileName(name: string): number | null {
  const match = TASK_FILE_PATTERN.exec(name);
  if (match === null) {
    return null;
  }
  const id = Number.parseInt(match[1] ?? '', 10);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * Splits a free form tag list into single tags.
 *
 * A tag can never contain white space, so white space is the only separator we
 * need. Duplicates are removed while keeping the original order.
 */
export function normalizeTags(input: string | readonly string[]): string[] {
  const raw: string[] = typeof input === 'string' ? input.split(/\s+/u) : [...input];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const candidate of raw) {
    const tag = candidate.trim();
    if (tag.length === 0 || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

/** True when the tag can be stored (no white space inside). */
export function isValidTag(tag: string): boolean {
  return tag.length > 0 && !/\s/u.test(tag);
}

function parseInteger(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Reads an order key, clamped to a non-negative integer. */
function normalizeOrder(value: string | undefined): number {
  const parsed = parseInteger(value);
  if (parsed === null || parsed < 0) {
    return 0;
  }
  return parsed;
}

/**
 * Removes characters that would break the `key=value` metadata format.
 *
 * A value cannot hold a line break: the metadata block is made of one `key=value`
 * per line.
 */
export function sanitizeMetadataValue(value: string): string {
  return value.replace(/[\r\n]+/gu, ' ').trim();
}

/** The metadata block of a file and the text that follows it. */
export interface MetadataBlock {
  /** The keys of the metadata block, in lower case. */
  readonly metadata: ReadonlyMap<string, string>;
  /** The text that follows the separator. */
  readonly description: string;
}

/**
 * Splits the content of a file into its metadata block and its description.
 *
 * The metadata block is made of `key=value` lines and ends with a line that
 * contains only the separator. Everything after it is the description.
 */
export function parseMetadataBlock(content: string): MetadataBlock {
  const lines = content.replace(/\r\n/gu, '\n').split('\n');
  const metadata = new Map<string, string>();
  let descriptionLines: string[] = [];
  let separatorFound = false;

  for (const line of lines) {
    if (!separatorFound && line.trim() === METADATA_SEPARATOR) {
      separatorFound = true;
      descriptionLines = [];
      continue;
    }
    if (separatorFound) {
      descriptionLines.push(line);
      continue;
    }
    const separator = line.indexOf('=');
    if (separator <= 0) {
      // Not a metadata line: without a separator it belongs to the description.
      descriptionLines.push(line);
      continue;
    }
    const key = line.slice(0, separator).trim().toLowerCase();
    if (key.length === 0) {
      descriptionLines.push(line);
      continue;
    }
    metadata.set(key, line.slice(separator + 1).trim());
  }

  const description = descriptionLines
    .join('\n')
    .replace(/^\n+/u, '')
    .replace(/\s+$/u, '');

  return { metadata, description };
}

/**
 * Parses a list of task ids separated by commas.
 *
 * The invalid ids and the duplicates are left out.
 */
export function parseIdList(value: string): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const part of value.split(',')) {
    const trimmed = part.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const id = Number.parseInt(trimmed, 10);
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * Parses the content of a task file.
 *
 * `idHint` is used when the file has no `id` key (for example when the file name
 * is the only source of truth).
 */
export function parseTask(content: string, idHint?: number): Task {
  const { metadata, description } = parseMetadataBlock(content);

  const rawStatus = metadata.get('status') ?? '';
  const status: TaskStatus = isTaskStatus(rawStatus) ? rawStatus : 'todo';
  const fileId = parseInteger(metadata.get('id'));

  return {
    id: fileId ?? idHint ?? 0,
    title: metadata.get('title') ?? '',
    status,
    parentId: parseInteger(metadata.get('parent')),
    tags: normalizeTags(metadata.get('tags') ?? ''),
    created: normalizeTaskTimestamp(metadata.get('created') ?? ''),
    updated: normalizeTaskTimestamp(metadata.get('updated') ?? ''),
    start: normalizeTaskTimestamp(metadata.get('start') ?? ''),
    end: normalizeTaskTimestamp(metadata.get('end') ?? ''),
    blockedBy: parseIdList(metadata.get('blocked_by') ?? ''),
    related: parseIdList(metadata.get('related') ?? ''),
    expanded: (metadata.get('expanded') ?? '').trim().toLowerCase() === 'true',
    kanbanHidden: (metadata.get('kanban_hidden') ?? '').trim().toLowerCase() === 'true',
    treeGanttHidden: (metadata.get('tree_gantt_hidden') ?? '').trim().toLowerCase() === 'true',
    type: isTaskType((metadata.get('type') ?? '').trim()) ? ((metadata.get('type') ?? '').trim() as TaskType) : 'Feature',
    role: isTaskRole((metadata.get('role') ?? '').trim()) ? ((metadata.get('role') ?? '').trim() as TaskRole) : 'Programming',
    kanbanOrder: normalizeOrder(metadata.get('kanban_order')),
    treeGanttOrder: normalizeOrder(metadata.get('tree_gantt_order')),
    description,
  };
}

/** Serializes a task into the on-disk format. */
export function serializeTask(task: Task): string {
  const lines: string[] = [
    `id=${task.id}`,
    `title=${sanitizeMetadataValue(task.title)}`,
    `status=${task.status}`,
  ];

  if (task.parentId !== null) {
    lines.push(`parent=${task.parentId}`);
  }

  lines.push(`tags=${task.tags.map((tag) => sanitizeMetadataValue(tag)).join(' ')}`);
  lines.push(`created=${sanitizeMetadataValue(task.created)}`);
  lines.push(`updated=${sanitizeMetadataValue(task.updated)}`);
  lines.push(`start=${sanitizeMetadataValue(task.start)}`);
  lines.push(`end=${sanitizeMetadataValue(task.end)}`);
  if (task.blockedBy.length > 0) {
    lines.push(`blocked_by=${task.blockedBy.join(',')}`);
  }
  if (task.related.length > 0) {
    lines.push(`related=${task.related.join(',')}`);
  }
  // The expanded key is written only when the branch is shown expanded: an
  // absent key means collapsed, so files stay small.
  if (task.expanded) {
    lines.push('expanded=true');
  }
  // Same rule for the hidden cards of the board: absent means visible.
  if (task.kanbanHidden === true) {
    lines.push('kanban_hidden=true');
  }
  // Same rule for the hidden rows of the tree and the Gantt chart.
  if (task.treeGanttHidden === true) {
    lines.push('tree_gantt_hidden=true');
  }
  lines.push(`type=${task.type ?? 'Feature'}`);
  lines.push(`role=${task.role ?? 'Programming'}`);
  lines.push(`kanban_order=${task.kanbanOrder ?? 0}`);
  lines.push(`tree_gantt_order=${task.treeGanttOrder ?? 0}`);
  lines.push(METADATA_SEPARATOR);

  const description = task.description.replace(/\r\n/gu, '\n').replace(/^\n+/u, '').replace(/\s+$/u, '');
  return `${lines.join('\n')}\n${description}\n`;
}

/** Builds a task out of the user input, stamping the creation/update time. */
export function buildTask(
  input: TaskInput,
  id: number,
  now: Date,
  parentId: number | null = null,
): Task {
  const timestamp = formatTaskTimestamp(now);
  const resolvedParent = input.parentId === undefined ? parentId : input.parentId;
  return {
    id,
    title: input.title.trim(),
    status: input.status,
    parentId: resolvedParent,
    tags: normalizeTags(input.tags),
    created: timestamp,
    updated: timestamp,
    start: input.start,
    end: input.end,
    blockedBy: [...input.blockedBy],
    related: [...input.related],
    expanded: false,
    kanbanHidden: false,
    treeGanttHidden: false,
    type: input.type ?? 'Feature',
    role: input.role ?? 'Programming',
    kanbanOrder: 0,
    treeGanttOrder: 0,
    description: input.description,
  };
}

/** Applies the user input to an existing task, keeping id and creation time. */
export function applyTaskInput(task: Task, input: TaskInput, now: Date): Task {
  return {
    ...task,
    title: input.title.trim(),
    status: input.status,
    parentId: input.parentId === undefined ? task.parentId : input.parentId,
    tags: normalizeTags(input.tags),
    start: input.start,
    end: input.end,
    blockedBy: [...input.blockedBy],
    related: [...input.related],
    updated: formatTaskTimestamp(now),
    description: input.description,
    type: input.type ?? task.type ?? 'Feature',
    role: input.role ?? task.role ?? 'Programming',
    kanbanOrder: task.kanbanOrder ?? 0,
    treeGanttOrder: task.treeGanttOrder ?? 0,
  };
}

/**
 * Returns a copy of the task under another parent.
 *
 * A `null` parent makes the task a root task again. The id, the title and the
 * creation time are kept, only the relation and the update time change.
 */
export function withParent(task: Task, parentId: number | null, now: Date): Task {
  return {
    ...task,
    parentId,
    updated: formatTaskTimestamp(now),
  };
}

/** Returns a copy of the task with another status. */
export function withStatus(task: Task, status: TaskStatus, now: Date): Task {
  return {
    ...task,
    status,
    updated: formatTaskTimestamp(now),
  };
}

/** Returns a copy of the task with another start and end date. */
export function withDates(task: Task, start: string, end: string, now: Date): Task {
  return {
    ...task,
    start,
    end,
    updated: formatTaskTimestamp(now),
  };
}

/**
 * Returns a copy of the task with another expanded state.
 *
 * The expanded key is a **view preference**: changing it does not touch the
 * `updated` timestamp of the file.
 */
export function withExpandedState(task: Task, expanded: boolean): Task {
  return {
    ...task,
    expanded,
  };
}

/**
 * Returns a copy of the task with another Kanban hidden state.
 *
 * Like the expanded state, it is a **view preference**: changing it does not
 * touch the `updated` timestamp of the file.
 */
export function withKanbanHidden(task: Task, hidden: boolean): Task {
  return {
    ...task,
    kanbanHidden: hidden,
  };
}

/**
 * Returns a copy of the task with another tree/Gantt hidden state.
 *
 * Like the expanded state, it is a **view preference**: changing it does not
 * touch the `updated` timestamp of the file.
 */
export function withTreeGanttHidden(task: Task, hidden: boolean): Task {
  return {
    ...task,
    treeGanttHidden: hidden,
  };
}

/**
 * Fills the dates the task does not have.
 *
 * A task is loaded without a start date: **today** is assigned to it. Without
 * an end date: **tomorrow**. The time is midnight, local. A date that already
 * exists is kept, and changing the dates this way does not touch the `updated`
 * timestamp of the file.
 */
export function withDefaultDates(task: Task, now: Date): Task {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const midnight = (date: Date): Date => {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  };
  const start = task.start.length === 0 ? formatTaskTimestamp(midnight(now)) : task.start;
  const end = task.end.length === 0 ? formatTaskTimestamp(midnight(tomorrow)) : task.end;
  return { ...task, start, end };
}
