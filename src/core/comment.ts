/**
 * The comments of a task.
 *
 * A comment is a text file of its own, named `comment_<id>.txt`, stored in the
 * project folder. Its format is the format of the task files: a block of
 * `key=value` lines, a line that contains only the separator and then the text
 * of the comment.
 *
 * ```
 * id=3
 * task=12
 * created=20261021024529365
 * updated=20261021024529365
 * ----
 * The text of the comment.
 * ```
 *
 * The `task` key holds the id of the task the comment belongs to. The ids of
 * the comments are incremental integers, unique in the project, exactly like
 * the ids of the tasks.
 */

import {
  METADATA_SEPARATOR,
  formatTaskTimestamp,
  normalizeTaskTimestamp,
  parseMetadataBlock,
} from './task.js';

export const COMMENT_FILE_PREFIX = 'comment_';
export const COMMENT_FILE_SUFFIX = '.txt';

const COMMENT_FILE_PATTERN = /^comment_(\d+)\.txt$/u;

/** A comment of a task. */
export interface TaskComment {
  /** Unique incremental integer, also encoded in the file name. */
  readonly id: number;
  /** The id of the task the comment belongs to. */
  readonly taskId: number;
  /** Creation timestamp in the compact format. */
  readonly created: string;
  /** Timestamp of the last update in the compact format. */
  readonly updated: string;
  /** The text of the comment. */
  readonly text: string;
}

/** `comment_12.txt` for the id `12`. */
export function commentFileName(id: number): string {
  return `${COMMENT_FILE_PREFIX}${id}${COMMENT_FILE_SUFFIX}`;
}

/** True when the file name follows the `comment_<id>.txt` convention. */
export function isCommentFileName(name: string): boolean {
  return COMMENT_FILE_PATTERN.test(name);
}

/** Extracts the id encoded in the file name, `null` when invalid. */
export function parseCommentIdFromFileName(name: string): number | null {
  const match = COMMENT_FILE_PATTERN.exec(name);
  if (match === null) {
    return null;
  }
  const id = Number.parseInt(match[1] ?? '', 10);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * Parses the content of a comment file.
 *
 * `idHint` is used when the file has no `id` key (the file name is then the
 * only source of truth).
 */
export function parseComment(content: string, idHint?: number): TaskComment {
  const { metadata, description } = parseMetadataBlock(content);

  const rawId = Number.parseInt(metadata.get('id') ?? '', 10);
  const rawTaskId = Number.parseInt(metadata.get('task') ?? '', 10);

  return {
    id: Number.isSafeInteger(rawId) ? rawId : (idHint ?? 0),
    taskId: Number.isSafeInteger(rawTaskId) ? rawTaskId : 0,
    created: normalizeTaskTimestamp(metadata.get('created') ?? ''),
    updated: normalizeTaskTimestamp(metadata.get('updated') ?? ''),
    text: description,
  };
}

/** Serializes a comment into the on-disk format. */
export function serializeComment(comment: TaskComment): string {
  const lines: string[] = [
    `id=${comment.id}`,
    `task=${comment.taskId}`,
    `created=${comment.created}`,
    `updated=${comment.updated}`,
    METADATA_SEPARATOR,
  ];
  const text = comment.text.replace(/\r\n/gu, '\n').replace(/^\n+/u, '').replace(/\s+$/u, '');
  return `${lines.join('\n')}\n${text}\n`;
}

/** Builds a comment, stamping the creation and update time. */
export function buildComment(
  id: number,
  taskId: number,
  text: string,
  now: Date,
): TaskComment {
  const timestamp = formatTaskTimestamp(now);
  return {
    id,
    taskId,
    created: timestamp,
    updated: timestamp,
    text,
  };
}

/**
 * The comments of a task, the most recent first.
 *
 * The creation date is the primary order; the id breaks the ties.
 */
export function sortComments(comments: readonly TaskComment[]): TaskComment[] {
  return [...comments].sort((left, right) => {
    if (left.created !== right.created) {
      return right.created.localeCompare(left.created);
    }
    return right.id - left.id;
  });
}
