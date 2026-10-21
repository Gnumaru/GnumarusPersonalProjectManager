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
 * created=2026-10-20T22:00:00.000Z
 * updated=2026-10-20T22:00:00.000Z
 * ----
 * Free text description.
 * ```
 *
 * The file starts with a metadata block made of `key=value` lines (like an `.ini`
 * file). The block is terminated by a line containing exactly four hyphens.
 * Everything after that line is the description.
 *
 * Root tasks (the ones without a parent) simply have no `parent` key.
 */

export const METADATA_SEPARATOR = '----';
export const TASK_FILE_PREFIX = 'task_';
export const TASK_FILE_SUFFIX = '.txt';
export const TASK_FILE_PATTERN = /^task_(\d+)\.txt$/;

export const TASK_STATUSES = ['todo', 'doing', 'done'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Task {
  /** Unique incremental integer, also encoded in the file name. */
  readonly id: number;
  readonly title: string;
  readonly status: TaskStatus;
  /** `null` for a root task. */
  readonly parentId: number | null;
  readonly tags: readonly string[];
  /** ISO 8601 timestamp, empty when unknown. */
  readonly created: string;
  /** ISO 8601 timestamp, empty when unknown. */
  readonly updated: string;
  readonly description: string;
}

export interface TaskInput {
  readonly title: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly tags: readonly string[];
}

export const EMPTY_TASK_INPUT: TaskInput = {
  title: '',
  description: '',
  status: 'todo',
  tags: [],
};

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
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

/** Removes characters that would break the `key=value` metadata format. */
function sanitizeMetaValue(value: string): string {
  return value.replace(/[\r\n]+/gu, ' ').trim();
}

/**
 * Parses the content of a task file.
 *
 * `idHint` is used when the file has no `id` key (for example when the file name
 * is the only source of truth).
 */
export function parseTask(content: string, idHint?: number): Task {
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

  const rawStatus = metadata.get('status') ?? '';
  const status: TaskStatus = isTaskStatus(rawStatus) ? rawStatus : 'todo';
  const fileId = parseInteger(metadata.get('id'));

  return {
    id: fileId ?? idHint ?? 0,
    title: metadata.get('title') ?? '',
    status,
    parentId: parseInteger(metadata.get('parent')),
    tags: normalizeTags(metadata.get('tags') ?? ''),
    created: metadata.get('created') ?? '',
    updated: metadata.get('updated') ?? '',
    description,
  };
}

/** Serializes a task into the on-disk format. */
export function serializeTask(task: Task): string {
  const lines: string[] = [
    `id=${task.id}`,
    `title=${sanitizeMetaValue(task.title)}`,
    `status=${task.status}`,
  ];

  if (task.parentId !== null) {
    lines.push(`parent=${task.parentId}`);
  }

  lines.push(`tags=${task.tags.map((tag) => sanitizeMetaValue(tag)).join(' ')}`);
  lines.push(`created=${sanitizeMetaValue(task.created)}`);
  lines.push(`updated=${sanitizeMetaValue(task.updated)}`);
  lines.push(METADATA_SEPARATOR);

  const description = task.description.replace(/\r\n/gu, '\n').replace(/^\n+/u, '').replace(/\s+$/u, '');
  return `${lines.join('\n')}\n${description}\n`;
}

/** Builds a task out of the user input, stamping the creation/update time. */
export function buildTask(input: TaskInput, id: number, now: Date): Task {
  const timestamp = now.toISOString();
  return {
    id,
    title: input.title.trim(),
    status: input.status,
    parentId: null,
    tags: normalizeTags(input.tags),
    created: timestamp,
    updated: timestamp,
    description: input.description,
  };
}

/** Applies the user input to an existing task, keeping id and creation time. */
export function applyTaskInput(task: Task, input: TaskInput, now: Date): Task {
  return {
    ...task,
    title: input.title.trim(),
    status: input.status,
    tags: normalizeTags(input.tags),
    updated: now.toISOString(),
    description: input.description,
  };
}
