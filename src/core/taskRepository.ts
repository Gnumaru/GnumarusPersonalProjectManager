/**
 * Data access layer: turns the task files living on disk into tasks and back.
 *
 * Everything goes through the low level operations service. Listing and
 * searching are done with `find` and `grep` (executed by the service) so the
 * browser never has to download the whole directory tree; only the files of the
 * current page are read.
 */

import { ApiClient, ApiError } from '../api/client.js';
import {
  applyTaskInput,
  buildTask,
  parseTask,
  parseTaskIdFromFileName,
  serializeTask,
  taskFileName,
  type Task,
  type TaskInput,
} from './task.js';
import { clampPage, computePageInfo, totalPages, type PageInfo } from './pagination.js';

/** Command used to list every task file below the project directory. */
export const FIND_TASK_FILES_COMMAND =
  "find . -type f -name 'task_*.txt' -not -path '*/.git/*' -not -path '*/.svn/*' -not -path '*/.hg/*' -print";

/**
 * Command used to search task files recursively.
 *
 * The pattern is fed through stdin (`-f -`) so it never becomes part of the
 * command line: no quoting or escaping problem is possible.
 */
export const GREP_TASK_FILES_COMMAND =
  "grep -rIl --fixed-strings --ignore-case --include='task_*.txt' --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg -f - .";

export interface TaskPage {
  readonly tasks: readonly Task[];
  readonly info: PageInfo;
}

export interface ListOptions {
  readonly page: number;
  readonly pageSize: number;
  /** Empty query lists every task file. */
  readonly query?: string;
}

/** Joins a directory and a relative path without duplicating separators. */
export function joinPath(directory: string, relative: string): string {
  if (relative.startsWith('/')) {
    return relative;
  }
  const base = directory.replace(/\/+$/u, '');
  return `${base}/${relative.replace(/^\.\//u, '')}`;
}

/** Normalizes a search term so it can safely be piped into `grep -f -`. */
export function normalizeSearchTerm(term: string): string {
  return term.replace(/[\r\n]+/gu, ' ').trim();
}

/** Extracts the task ids encoded in the file names. */
export function extractTaskIds(paths: readonly string[]): number[] {
  const ids: number[] = [];
  for (const path of paths) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const id = parseTaskIdFromFileName(name);
    if (id !== null) {
      ids.push(id);
    }
  }
  return ids;
}

export class TaskRepository {
  readonly api: ApiClient;

  constructor(api: ApiClient) {
    this.api = api;
  }

  /** Absolute paths of every task file below `projectDir`, sorted by id. */
  async listTaskFilePaths(projectDir: string): Promise<string[]> {
    const result = await this.api.execShell({
      command: FIND_TASK_FILES_COMMAND,
      cwd: projectDir,
      timeout: 30,
    });
    if (result.returncode !== 0) {
      throw new Error(
        `Unable to list the tasks of "${projectDir}": ${result.stderr.trim() || `exit code ${result.returncode}`}`,
      );
    }
    return this.parsePaths(result.stdout, projectDir);
  }

  /** Absolute paths of the task files whose content matches `term`. */
  async searchTaskFilePaths(projectDir: string, term: string): Promise<string[]> {
    const normalized = normalizeSearchTerm(term);
    if (normalized.length === 0) {
      return this.listTaskFilePaths(projectDir);
    }

    const result = await this.api.execShell({
      command: GREP_TASK_FILES_COMMAND,
      cwd: projectDir,
      stdin: `${normalized}\n`,
      timeout: 60,
    });

    // grep exits with 1 when nothing matched, which is not an error.
    if (result.returncode !== 0 && result.returncode !== 1) {
      throw new Error(
        `Unable to search the tasks of "${projectDir}": ${result.stderr.trim() || `exit code ${result.returncode}`}`,
      );
    }
    return this.parsePaths(result.stdout, projectDir);
  }

  /** Reads and parses a single task file. */
  async loadTask(path: string): Promise<Task> {
    const file = await this.api.readFile(path);
    const name = path.slice(path.lastIndexOf('/') + 1);
    return parseTask(file.content, parseTaskIdFromFileName(name) ?? undefined);
  }

  /**
   * Loads one page of tasks.
   *
   * Only the files of the requested page are read, the previous page is never
   * kept in memory.
   */
  async getPage(projectDir: string, options: ListOptions): Promise<TaskPage> {
    const query = options.query ?? '';
    const paths = query.trim().length === 0
      ? await this.listTaskFilePaths(projectDir)
      : await this.searchTaskFilePaths(projectDir, query);

    const info = computePageInfo(options.page, options.pageSize, paths.length);
    const start = (info.page - 1) * options.pageSize;
    const pagePaths = paths.slice(start, start + options.pageSize);

    const tasks: Task[] = [];
    for (const path of pagePaths) {
      try {
        tasks.push(await this.loadTask(path));
      } catch (error) {
        // The file disappeared between the listing and the read: skip it.
        if (error instanceof ApiError && error.status === 404) {
          continue;
        }
        throw error;
      }
    }

    return { tasks, info };
  }

  /** Id that will be used for the next task created in `projectDir`. */
  async nextTaskId(projectDir: string): Promise<number> {
    const paths = await this.listTaskFilePaths(projectDir);
    const ids = extractTaskIds(paths);
    return ids.length === 0 ? 1 : Math.max(...ids) + 1;
  }

  /** Creates a new root task file. */
  async createTask(projectDir: string, input: TaskInput): Promise<Task> {
    let id = await this.nextTaskId(projectDir);

    // The id must be unique: retry with the next one when the file already exists.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const path = joinPath(projectDir, taskFileName(id));
      const task = buildTask(input, id, new Date());
      try {
        await this.api.createFile(path, serializeTask(task));
        return task;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          id += 1;
          continue;
        }
        throw error;
      }
    }
    throw new Error('Unable to allocate a free task id');
  }

  /** Updates an existing task file, keeping its id and creation time. */
  async updateTask(path: string, changes: TaskInput): Promise<Task> {
    const current = await this.loadTask(path);
    const updated = applyTaskInput(current, changes, new Date());
    await this.api.overwriteFile(path, serializeTask(updated));
    return updated;
  }

  /** Deletes a task file. */
  async deleteTask(path: string): Promise<void> {
    await this.api.deleteFile(path);
  }

  /** Path of the file holding the task with the given id. */
  taskPath(projectDir: string, id: number): string {
    return joinPath(projectDir, taskFileName(id));
  }

  /** Number of pages for the current amount of tasks. */
  pageCount(totalItems: number, pageSize: number): number {
    return totalPages(totalItems, pageSize);
  }

  /** Clamps a page number to the available range. */
  safePage(page: number, totalItems: number, pageSize: number): number {
    return clampPage(page, totalPages(totalItems, pageSize));
  }

  private parsePaths(stdout: string, projectDir: string): string[] {
    const paths: string[] = [];
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      paths.push(joinPath(projectDir, trimmed));
    }
    return paths.sort((left, right) => {
      const leftId = parseTaskIdFromFileName(left.slice(left.lastIndexOf('/') + 1)) ?? 0;
      const rightId = parseTaskIdFromFileName(right.slice(right.lastIndexOf('/') + 1)) ?? 0;
      if (leftId !== rightId) {
        return leftId - rightId;
      }
      return left.localeCompare(right);
    });
  }
}
