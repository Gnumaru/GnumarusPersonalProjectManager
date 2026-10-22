/**
 * Note file format.
 *
 * A note is a plain text file named `note_<id>.txt`, stored in the project
 * folder. Its format is the format of the task files: a block of `key=value`
 * lines, a line that contains only the separator and then the body of the note.
 *
 * ```
 * id=12
 * title=Shopping list
 * created=20261022100000000
 * updated=20261022100000000
 * ----
 * # Shopping
 *
 * - milk
 * - eggs
 * ```
 *
 * The body of a note is **markdown**: it is edited as plain text and it can be
 * displayed as rendered markdown.
 *
 * The notes do not involve the tasks: a note has no parent, no status and no
 * tag. The ids of the notes are incremental integers, unique in the project,
 * exactly like the ids of the tasks and the ids of the comments.
 */

import {
  METADATA_SEPARATOR,
  formatTaskTimestamp,
  normalizeTaskTimestamp,
  parseMetadataBlock,
  sanitizeMetadataValue,
} from './task.js';

export const NOTE_FILE_PREFIX = 'note_';
export const NOTE_FILE_SUFFIX = '.txt';

const NOTE_FILE_PATTERN = /^note_(\d+)\.txt$/u;

/** A note of the project. */
export interface Note {
  /** Unique incremental integer, also encoded in the file name. */
  readonly id: number;
  /** The title of the note. */
  readonly title: string;
  /** Creation timestamp in the compact format, empty when unknown. */
  readonly created: string;
  /** Timestamp of the last update in the compact format, empty when unknown. */
  readonly updated: string;
  /** The body of the note, in markdown. */
  readonly content: string;
}

/** What the user types in the editor of a note. */
export interface NoteInput {
  readonly title: string;
  readonly content: string;
}

/** The parts of a note a search can look at. */
export const NOTE_SEARCH_SCOPES = ['both', 'title', 'content'] as const;

export type NoteSearchScope = (typeof NOTE_SEARCH_SCOPES)[number];

/** The name of every scope, as it is shown to the user. */
export const NOTE_SCOPE_LABELS: Readonly<Record<NoteSearchScope, string>> = {
  both: 'Title and content',
  title: 'Title only',
  content: 'Content only',
};

export const EMPTY_NOTE_INPUT: NoteInput = {
  title: '',
  content: '',
};

/** `note_12.txt` for the id `12`. */
export function noteFileName(id: number): string {
  return `${NOTE_FILE_PREFIX}${id}${NOTE_FILE_SUFFIX}`;
}

/** True when the file name follows the `note_<id>.txt` convention. */
export function isNoteFileName(name: string): boolean {
  return NOTE_FILE_PATTERN.test(name);
}

/** Extracts the id encoded in a `note_<id>.txt` file name, `null` when invalid. */
export function parseNoteIdFromFileName(name: string): number | null {
  const match = NOTE_FILE_PATTERN.exec(name);
  if (match === null) {
    return null;
  }
  const id = Number.parseInt(match[1] ?? '', 10);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * Parses the content of a note file.
 *
 * `idHint` is used when the file has no `id` key (the file name is then the
 * only source of truth).
 */
export function parseNote(content: string, idHint?: number): Note {
  const { metadata, description } = parseMetadataBlock(content);

  const rawId = Number.parseInt(metadata.get('id') ?? '', 10);

  return {
    id: Number.isSafeInteger(rawId) ? rawId : (idHint ?? 0),
    title: metadata.get('title') ?? '',
    created: normalizeTaskTimestamp(metadata.get('created') ?? ''),
    updated: normalizeTaskTimestamp(metadata.get('updated') ?? ''),
    content: description,
  };
}

/** Serializes a note into the on-disk format. */
export function serializeNote(note: Note): string {
  const lines: string[] = [
    `id=${note.id}`,
    `title=${sanitizeMetadataValue(note.title)}`,
    `created=${sanitizeMetadataValue(note.created)}`,
    `updated=${sanitizeMetadataValue(note.updated)}`,
    METADATA_SEPARATOR,
  ];
  const content = note.content.replace(/\r\n/gu, '\n').replace(/^\n+/u, '').replace(/\s+$/u, '');
  return `${lines.join('\n')}\n${content}\n`;
}

/** Builds a note, stamping the creation and update time. */
export function buildNote(input: NoteInput, id: number, now: Date): Note {
  const timestamp = formatTaskTimestamp(now);
  return {
    id,
    title: input.title.trim(),
    created: timestamp,
    updated: timestamp,
    content: input.content,
  };
}

/** Applies the user input to an existing note, keeping the id and the creation time. */
export function applyNoteInput(note: Note, input: NoteInput, now: Date): Note {
  return {
    ...note,
    title: input.title.trim(),
    updated: formatTaskTimestamp(now),
    content: input.content,
  };
}

/**
 * True when the note matches the search term.
 *
 * The comparison ignores the case and looks for the term as a piece of text,
 * exactly like the `grep --fixed-strings --ignore-case` of the service.
 */
export function noteMatches(note: Note, term: string, scope: NoteSearchScope): boolean {
  const needle = term.trim().toLowerCase();
  if (needle.length === 0) {
    return true;
  }
  if (scope === 'title' || scope === 'both') {
    if (note.title.toLowerCase().includes(needle)) {
      return true;
    }
  }
  if (scope === 'content' || scope === 'both') {
    if (note.content.toLowerCase().includes(needle)) {
      return true;
    }
  }
  return false;
}

/**
 * A one line summary of the body of a note, for the listing.
 *
 * The markdown marks are removed: the listing shows the text of the note, not
 * its source.
 */
export function notePreview(content: string, maximumLength = 80): string {
  const plain = content
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`([^`]*)`/gu, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/^#{1,6}\s+/gmu, '')
    .replace(/^\s*>\s?/gmu, '')
    .replace(/^\s*[-*+]\s+/gmu, '')
    .replace(/^\s*\d+[.)]\s+/gmu, '')
    .replace(/[*_~]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return plain.length > maximumLength ? `${plain.slice(0, maximumLength - 1)}…` : plain;
}
