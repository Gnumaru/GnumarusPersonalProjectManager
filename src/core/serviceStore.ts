/**
 * The implementation of the project store that uses the low level operations
 * service.
 *
 * The files live on the disk of the machine: they are read and written through
 * the REST API of the service, and the shell of the service is used to list and
 * to search them.
 */

import { ApiError, type ApiClient } from '../api/client.js';
import {
  buildComment,
  commentFileName,
  parseComment,
  parseCommentIdFromFileName,
  serializeComment,
  sortComments,
  type TaskComment,
} from './comment.js';
import {
  isTaskStatus,
  normalizeTags,
  parseTask,
  parseTaskIdFromFileName,
  serializeTask,
  taskFileName,
  type Task,
  type TaskStatus,
} from './task.js';
import {
  noteFileName,
  noteMatches,
  parseNote,
  parseNoteIdFromFileName,
  serializeNote,
  type Note,
  type NoteSearchScope,
} from './note.js';
import type { NoteSummary, ProjectFile, ProjectKind, ProjectStore, TaskSummary } from './projectStore.js';

/** The metadata of a task, while it is being read. */
interface MutableMetadata {
  id: number | null;
  title: string;
  status: TaskStatus;
  parentId: number | null;
  tags: string[];
  start: string;
  end: string;
  updated: string;
  expanded: boolean;
}

/** Command used to list the task files of the project. */
export const FIND_TASK_FILES_COMMAND =
  "find . -type f -name 'task_*.txt' -not -path '*/.git/*' -not -path '*/.svn/*' -not -path '*/.hg/*' -print";

/** Command used to list the comment files of the project. */
export const FIND_COMMENT_FILES_COMMAND =
  "find . -type f -name 'comment_*.txt' -not -path '*/.git/*' -not -path '*/.svn/*' -not -path '*/.hg/*' -print";

/** Command used to list the note files of the project. */
export const FIND_NOTE_FILES_COMMAND =
  "find . -type f -name 'note_*.txt' -not -path '*/.git/*' -not -path '*/.svn/*' -not -path '*/.hg/*' -print";

/**
 * Command used to search the note files.
 *
 * The pattern is fed through stdin (`-f -`) so it never becomes part of the
 * command line: no quoting or escaping problem is possible.
 */
export const GREP_NOTE_FILES_COMMAND =
  "grep -rIl --fixed-strings --ignore-case --include='note_*.txt' --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg -f - .";

/**
 * Command used to read the titles of the notes.
 *
 * Only the `title=` keys are read, so the answer stays small and no file has
 * to be downloaded to search a title.
 */
export const READ_NOTE_TITLES_COMMAND =
  "grep -rH --include='note_*.txt' --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg -e '^title=' -e '^updated=' .";

/** Command used to list every file of the project. */
export const FIND_ALL_FILES_COMMAND =
  "find . -type f -not -path '*/.git/*' -not -path '*/.svn/*' -not -path '*/.hg/*' -print";

/**
 * Command used to count the children of every task.
 *
 * Only the `parent=` keys are read, so the answer stays small.
 */
export const COUNT_CHILDREN_COMMAND =
  "grep -rh --include='task_*.txt' --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg '^parent=' . | cut -d= -f2 | sort | uniq -c";

/**
 * Command used to read the metadata of every task.
 *
 * Everything the tree, the board and the Gantt chart need is read in **one**
 * command: the parent of every task, its status, its title, its tags and its
 * dates. The description of the tasks never reaches the browser.
 */
export const READ_METADATA_COMMAND =
  "grep -rH --include='task_*.txt' --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg -e '^id=' -e '^parent=' -e '^status=' -e '^title=' -e '^tags=' -e '^start=' -e '^end=' -e '^updated=' -e '^expanded=' .";

/**
 * Command used to detect the presence of ripgrep (`rg`) on the machine.
 *
 * When the command answers (exit code 0) the searches may use ripgrep, which is
 * much faster than `grep` on big projects.
 */
export const DETECT_RIPGREP_COMMAND = 'command -v rg';

/**
 * Command used to search the task files with **ripgrep**.
 *
 * Same contract as `GREP_TASK_FILES_COMMAND`: the pattern is fed through stdin
 * (`-f -`) and the answer is one path per matching file. `rg` exits with 1 when
 * nothing matched, which is not an error.
 */
export const RG_TASK_SEARCH_COMMAND = "rg -il --fixed-strings --no-ignore -g 'task_*.txt' -f - .";

/** Command used to search the note files with **ripgrep**. */
export const RG_NOTE_SEARCH_COMMAND = "rg -il --fixed-strings --no-ignore -g 'note_*.txt' -f - .";

/**
 * Command used to search the task files.
 *
 * The pattern is fed through stdin (`-f -`) so it never becomes part of the
 * command line: no quoting or escaping problem is possible.
 */
export const GREP_TASK_FILES_COMMAND =
  "grep -rIl --fixed-strings --ignore-case --include='task_*.txt' --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg -f - .";

/** Command used to list the comment files of a task. */
export function commentsCommand(taskId: number): string {
  return `grep -rl --include='comment_*.txt' --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg -e '^task=${taskId}$' .`;
}

/**
 * Turns the output of a `find` into absolute paths, sorted by task id.
 *
 * The id of a file is read from its name: the parser of the ids can be changed
 * to list the notes or the comments instead of the tasks.
 */
export function parseServicePaths(
  stdout: string,
  projectDir: string,
  parseId: (name: string) => number | null = parseTaskIdFromFileName,
): string[] {
  const base = projectDir.replace(/\/+$/u, '');
  const paths: { path: string; id: number }[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const path = trimmed.startsWith('/') ? trimmed : `${base}/${trimmed.replace(/^\.\//u, '')}`;
    const name = path.slice(path.lastIndexOf('/') + 1);
    paths.push({ path, id: parseId(name) ?? Number.MAX_SAFE_INTEGER });
  }
  paths.sort((left, right) => {
    if (left.id !== right.id) {
      return left.id - right.id;
    }
    return left.path.localeCompare(right.path);
  });
  return paths.map((entry) => entry.path);
}

export class ServiceProjectStore implements ProjectStore {
  readonly kind: ProjectKind = 'service';
  private readonly api: ApiClient;
  private readonly projectDir: string;
  /** Cached answer of the ripgrep probe: `null` until it ran once. */
  private ripgrep: boolean | null = null;

  constructor(api: ApiClient, projectDir: string) {
    this.api = api;
    this.projectDir = projectDir;
  }

  /**
   * Whether `rg` is available on the machine.
   *
   * The presence of ripgrep is probed once and cached: the searches then prefer
   * it, and fall back to `grep` when it is not installed.
   */
  private async hasRipgrep(): Promise<boolean> {
    if (this.ripgrep === null) {
      try {
        const result = await this.api.execShell({
          command: DETECT_RIPGREP_COMMAND,
          cwd: this.projectDir,
          timeout: 10,
        });
        this.ripgrep = result.returncode === 0;
      } catch {
        this.ripgrep = false;
      }
    }
    return this.ripgrep;
  }

  /** The absolute path of a file of the project. */
  private absolute(path: string): string {
    return path.startsWith('/') ? path : `${this.projectDir.replace(/\/+$/u, '')}/${path}`;
  }

  /** The path of a file, relative to the project folder. */
  private relative(path: string): string {
    const prefix = `${this.projectDir.replace(/\/+$/u, '')}/`;
    return path.startsWith(prefix) ? path.slice(prefix.length) : path;
  }

  async listTaskPaths(): Promise<readonly string[]> {
    const paths = await this.listTaskPathsInternal();
    return paths.map((path) => this.relative(path));
  }

  async searchTaskPaths(term: string): Promise<readonly string[]> {
    const paths = await this.searchTaskPathsInternal(term);
    return paths.map((path) => this.relative(path));
  }

  async listTasks(): Promise<readonly TaskSummary[]> {
    const metadata = await this.readMetadata();
    return [...metadata.values()];
  }

  /**
   * Reads the metadata of every task with **one** command.
   *
   * The name of the file is printed in front of the keys (`-H`), so the answer
   * stays small: a few short lines per task.
   */
  private async readMetadata(): Promise<Map<string, TaskSummary>> {
    const metadata = new Map<string, TaskSummary>();
    const result = await this.api.execShell({
      command: READ_METADATA_COMMAND,
      cwd: this.projectDir,
      timeout: 60,
    });
    if (result.returncode !== 0 && result.returncode !== 1) {
      throw new Error(
        `Unable to read the tasks of "${this.projectDir}": ${result.stderr.trim() || `exit code ${result.returncode}`}`,
      );
    }

    const values = new Map<string, MutableMetadata>();
    for (const line of result.stdout.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const match = /^(.*?):(id|parent|status|title|tags|start|end|updated|expanded)=(.*)$/u.exec(trimmed);
      if (match === null) {
        continue;
      }
      const relative = (match[1] ?? '').replace(/^\.\//u, '');
      const key = match[2] ?? '';
      const value = match[3] ?? '';
      if (relative.length === 0) {
        continue;
      }
      const current = values.get(relative) ?? {
        id: null,
        title: '',
        status: 'todo' as TaskStatus,
        parentId: null,
        tags: [] as string[],
        start: '',
        end: '',
        updated: '',
        expanded: false,
      };
      if (key === 'id') {
        const id = Number.parseInt(value, 10);
        current.id = Number.isSafeInteger(id) ? id : null;
      } else if (key === 'title') {
        current.title = value;
      } else if (key === 'status') {
        current.status = isTaskStatus(value) ? value : 'todo';
      } else if (key === 'parent') {
        const parentId = Number.parseInt(value, 10);
        current.parentId = Number.isSafeInteger(parentId) ? parentId : null;
      } else if (key === 'tags') {
        current.tags = normalizeTags(value);
      } else if (key === 'start') {
        current.start = value;
      } else if (key === 'end') {
        current.end = value;
      } else if (key === 'updated') {
        current.updated = value;
      } else if (key === 'expanded') {
        current.expanded = value.trim().toLowerCase() === 'true';
      }
      values.set(relative, current);
    }

    for (const [relative, current] of values) {
      const name = relative.slice(relative.lastIndexOf('/') + 1);
      const id = current.id ?? parseTaskIdFromFileName(name);
      if (id === null) {
        continue;
      }
      metadata.set(relative, {
        id,
        title: current.title,
        status: current.status,
        parentId: current.parentId,
        tags: current.tags,
        start: current.start,
        end: current.end,
        updated: current.updated,
        expanded: current.expanded,
        path: relative,
      });
    }
    return metadata;
  }

  async childCounts(): Promise<ReadonlyMap<number, number>> {
    const counts = new Map<number, number>();
    const result = await this.api.execShell({
      command: COUNT_CHILDREN_COMMAND,
      cwd: this.projectDir,
      timeout: 60,
    });
    if (result.returncode !== 0 && result.returncode !== 1) {
      throw new Error(
        `Unable to count the children of "${this.projectDir}": ${result.stderr.trim() || `exit code ${result.returncode}`}`,
      );
    }
    for (const line of result.stdout.split('\n')) {
      const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(line);
      if (match === null) {
        continue;
      }
      const count = Number.parseInt(match[1] ?? '', 10);
      const parentId = Number.parseInt(match[2] ?? '', 10);
      if (Number.isSafeInteger(count) && Number.isSafeInteger(parentId)) {
        counts.set(parentId, count);
      }
    }
    return counts;
  }

  async readTask(path: string): Promise<Task> {
    const file = await this.api.readFile(this.absolute(path));
    const name = path.slice(path.lastIndexOf('/') + 1);
    return parseTask(file.content, parseTaskIdFromFileName(name) ?? undefined);
  }

  async writeTask(path: string, task: Task): Promise<void> {
    await this.api.overwriteFile(this.absolute(path), serializeTask(task));
  }

  async createTaskFile(path: string, task: Task): Promise<void> {
    await this.api.createFile(this.absolute(path), serializeTask(task));
  }

  async deleteFile(path: string): Promise<void> {
    await this.api.deleteFile(this.absolute(path));
  }

  async listComments(taskId: number): Promise<readonly TaskComment[]> {
    const paths = await this.findCommentPaths(taskId);
    const comments: TaskComment[] = [];
    for (const path of paths) {
      try {
        comments.push(await this.loadComment(path));
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          continue;
        }
        throw error;
      }
    }
    return sortComments(comments);
  }

  async createComment(taskId: number, text: string): Promise<TaskComment> {
    let id = await this.nextCommentId();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const comment = buildComment(id, taskId, text, new Date());
      try {
        await this.api.createFile(this.absolute(this.commentPath(id)), serializeComment(comment));
        return comment;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          id += 1;
          continue;
        }
        throw error;
      }
    }
    throw new Error('Unable to allocate a free comment id');
  }

  async writeComment(comment: TaskComment): Promise<void> {
    await this.api.overwriteFile(this.absolute(this.commentPath(comment.id)), serializeComment(comment));
  }

  async deleteComment(path: string): Promise<void> {
    await this.api.deleteFile(this.absolute(path));
  }

  // --------------------------------------------------------------- notes --

  async listNotePaths(): Promise<readonly string[]> {
    const paths = await this.listNotePathsInternal();
    return paths.map((path) => this.relative(path));
  }

  async listNoteSummaries(): Promise<readonly NoteSummary[]> {
    const result = await this.api.execShell({
      command: READ_NOTE_TITLES_COMMAND,
      cwd: this.projectDir,
      timeout: 60,
    });
    if (result.returncode !== 0 && result.returncode !== 1) {
      throw new Error(
        `Unable to list the notes of "${this.projectDir}": ${result.stderr.trim() || `exit code ${result.returncode}`}`,
      );
    }
    const values = new Map<string, { id: number | null; title: string; updated: string }>();
    for (const line of result.stdout.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const match = /^(.*?):(title|updated)=(.*)$/u.exec(trimmed);
      if (match === null) {
        continue;
      }
      const path = (match[1] ?? '').replace(/^\.\//u, '');
      if (path.length === 0) {
        continue;
      }
      const key = match[2] ?? '';
      const value = match[3] ?? '';
      const current = values.get(path) ?? { id: null, title: '', updated: '' };
      if (key === 'title') {
        current.title = value;
      } else {
        current.updated = value;
      }
      if (current.id === null) {
        const id = parseNoteIdFromFileName(path.slice(path.lastIndexOf('/') + 1));
        if (id !== null) {
          current.id = id;
        }
      }
      values.set(path, current);
    }
    const summaries: NoteSummary[] = [];
    for (const [path, current] of values) {
      if (current.id === null) {
        continue;
      }
      summaries.push({
        id: current.id,
        title: current.title,
        updated: current.updated,
        path: this.relative(path),
      });
    }
    // Sorted by id, like the listing itself.
    return summaries.sort((left, right) => left.id - right.id);
  }

  /**
   * Searches the notes.
   *
   * * **both** and **content** start with the same `grep`: the files that hold
   *   the term somewhere. The content search then reads those files and keeps
   *   the ones where the term is really in the body of the note;
   * * **title** reads the `title=` keys of every note with one command: no
   *   file has to be downloaded.
   */
  async searchNotePaths(term: string, scope: NoteSearchScope): Promise<readonly string[]> {
    const normalized = term.trim();
    if (normalized.length === 0) {
      return this.listNotePaths();
    }
    if (scope === 'title') {
      return this.searchNoteTitles(normalized);
    }
    const candidates = await this.searchNotePathsInternal(normalized);
    if (scope === 'both') {
      return candidates.map((path) => this.relative(path));
    }
    const matches: string[] = [];
    for (const path of candidates) {
      try {
        const note = await this.loadNote(path);
        if (noteMatches(note, normalized, 'content')) {
          matches.push(this.relative(path));
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          continue;
        }
        throw error;
      }
    }
    return matches;
  }

  async readNote(path: string): Promise<Note> {
    return this.loadNote(this.absolute(path));
  }

  async writeNote(path: string, note: Note): Promise<void> {
    await this.api.overwriteFile(this.absolute(path), serializeNote(note));
  }

  async createNoteFile(path: string, note: Note): Promise<void> {
    await this.api.createFile(this.absolute(path), serializeNote(note));
  }

  async nextNoteId(): Promise<number> {
    const paths = await this.listNotePathsInternal();
    const ids: number[] = [];
    for (const path of paths) {
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
    const paths = await this.listTaskPathsInternal();
    const ids: number[] = [];
    for (const path of paths) {
      const id = parseTaskIdFromFileName(path.slice(path.lastIndexOf('/') + 1));
      if (id !== null) {
        ids.push(id);
      }
    }
    return ids.length === 0 ? 1 : Math.max(...ids) + 1;
  }

  async nextCommentId(): Promise<number> {
    const paths = await this.listCommentPaths();
    const ids: number[] = [];
    for (const path of paths) {
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
    const paths = await this.listAllPaths();
    const files: ProjectFile[] = [];
    for (const path of paths) {
      try {
        const file = await this.api.readFile(path);
        files.push({ path: this.relative(path), content: file.content });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          continue;
        }
        throw error;
      }
    }
    return files;
  }

  async replaceAll(files: readonly ProjectFile[]): Promise<void> {
    for (const path of await this.listAllPaths()) {
      await this.api.deleteFile(path);
    }
    for (const file of files) {
      await this.api.createFile(this.absolute(file.path), file.content);
    }
  }

  // ------------------------------------------------------------- internals --

  /** The absolute paths of the task files. */
  private async listTaskPathsInternal(): Promise<string[]> {
    const result = await this.api.execShell({
      command: FIND_TASK_FILES_COMMAND,
      cwd: this.projectDir,
      timeout: 30,
    });
    if (result.returncode !== 0) {
      throw new Error(
        `Unable to list the tasks of "${this.projectDir}": ${result.stderr.trim() || `exit code ${result.returncode}`}`,
      );
    }
    return parseServicePaths(result.stdout, this.projectDir);
  }

  /** The absolute paths of the comment files. */
  private async listCommentPaths(): Promise<string[]> {
    const result = await this.api.execShell({
      command: FIND_COMMENT_FILES_COMMAND,
      cwd: this.projectDir,
      timeout: 30,
    });
    if (result.returncode !== 0 && result.returncode !== 1) {
      throw new Error(
        `Unable to list the comments of "${this.projectDir}": ${result.stderr.trim() || `exit code ${result.returncode}`}`,
      );
    }
    return parseServicePaths(result.stdout, this.projectDir);
  }

  /** The absolute paths of the note files. */
  private async listNotePathsInternal(): Promise<string[]> {
    const result = await this.api.execShell({
      command: FIND_NOTE_FILES_COMMAND,
      cwd: this.projectDir,
      timeout: 30,
    });
    if (result.returncode !== 0 && result.returncode !== 1) {
      throw new Error(
        `Unable to list the notes of "${this.projectDir}": ${result.stderr.trim() || `exit code ${result.returncode}`}`,
      );
    }
    return parseServicePaths(result.stdout, this.projectDir, parseNoteIdFromFileName);
  }

  /** The absolute paths of the note files whose content holds the term. */
  private async searchNotePathsInternal(term: string): Promise<string[]> {
    const useRipgrep = await this.hasRipgrep();
    const result = await this.api.execShell({
      command: useRipgrep ? RG_NOTE_SEARCH_COMMAND : GREP_NOTE_FILES_COMMAND,
      cwd: this.projectDir,
      stdin: `${term.replace(/[\r\n]+/gu, ' ')}\n`,
      timeout: 60,
    });
    // grep and rg exit with 1 when nothing matched, which is not an error.
    if (result.returncode !== 0 && result.returncode !== 1) {
      throw new Error(
        `Unable to search the notes of "${this.projectDir}": ${result.stderr.trim() || `exit code ${result.returncode}`}`,
      );
    }
    return parseServicePaths(result.stdout, this.projectDir, parseNoteIdFromFileName);
  }

  /**
   * The paths of the notes whose title holds the term.
   *
   * The titles of every note are read with one command: the answer is a few
   * short lines per note and no file has to be downloaded.
   */
  private async searchNoteTitles(term: string): Promise<string[]> {
    const result = await this.api.execShell({
      command: READ_NOTE_TITLES_COMMAND,
      cwd: this.projectDir,
      timeout: 60,
    });
    if (result.returncode !== 0 && result.returncode !== 1) {
      throw new Error(
        `Unable to search the notes of "${this.projectDir}": ${result.stderr.trim() || `exit code ${result.returncode}`}`,
      );
    }

    const needle = term.toLowerCase();
    const paths: string[] = [];
    for (const line of result.stdout.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const match = /^(.*?):title=(.*)$/u.exec(trimmed);
      if (match === null) {
        continue;
      }
      const relative = (match[1] ?? '').replace(/^\.\//u, '');
      const title = match[2] ?? '';
      if (relative.length === 0 || !title.toLowerCase().includes(needle)) {
        continue;
      }
      paths.push(relative);
    }
    return paths;
  }

  /** Reads a note file. */
  private async loadNote(path: string): Promise<Note> {
    const file = await this.api.readFile(path);
    const name = path.slice(path.lastIndexOf('/') + 1);
    return parseNote(file.content, parseNoteIdFromFileName(name) ?? undefined);
  }

  /** The absolute paths of every file of the project. */
  private async listAllPaths(): Promise<string[]> {
    const result = await this.api.execShell({
      command: FIND_ALL_FILES_COMMAND,
      cwd: this.projectDir,
      timeout: 30,
    });
    if (result.returncode !== 0) {
      throw new Error(
        `Unable to list the files of "${this.projectDir}": ${result.stderr.trim() || `exit code ${result.returncode}`}`,
      );
    }
    return parseServicePaths(result.stdout, this.projectDir);
  }

  /** The absolute paths of the task files whose content matches the term. */
  private async searchTaskPathsInternal(term: string): Promise<string[]> {
    const normalized = term.trim();
    if (normalized.length === 0) {
      return this.listTaskPathsInternal();
    }
    const useRipgrep = await this.hasRipgrep();
    const result = await this.api.execShell({
      command: useRipgrep ? RG_TASK_SEARCH_COMMAND : GREP_TASK_FILES_COMMAND,
      cwd: this.projectDir,
      stdin: `${normalized.replace(/[\r\n]+/gu, ' ')}\n`,
      timeout: 60,
    });
    // grep and rg exit with 1 when nothing matched, which is not an error.
    if (result.returncode !== 0 && result.returncode !== 1) {
      throw new Error(
        `Unable to search the tasks of "${this.projectDir}": ${result.stderr.trim() || `exit code ${result.returncode}`}`,
      );
    }
    return parseServicePaths(result.stdout, this.projectDir);
  }

  /** The absolute paths of the comment files of a task. */
  private async findCommentPaths(taskId: number): Promise<string[]> {
    const result = await this.api.execShell({
      command: commentsCommand(taskId),
      cwd: this.projectDir,
      timeout: 60,
    });
    if (result.returncode !== 0 && result.returncode !== 1) {
      throw new Error(
        `Unable to list the comments of the task #${taskId}: ${result.stderr.trim() || `exit code ${result.returncode}`}`,
      );
    }
    return parseServicePaths(result.stdout, this.projectDir);
  }

  /** Reads a comment file. */
  private async loadComment(path: string): Promise<TaskComment> {
    const file = await this.api.readFile(path);
    const name = path.slice(path.lastIndexOf('/') + 1);
    return parseComment(file.content, parseCommentIdFromFileName(name) ?? undefined);
  }
}
