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
  isTaskStatus,
  normalizeTags,
  parseTask,
  parseTaskIdFromFileName,
  serializeTask,
  taskFileName,
  withDates,
  withParent,
  withStatus,
  type Task,
  type TaskCard,
  type TaskInput,
  type TaskStatus,
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

/**
 * Command used to count the children of every task.
 *
 * Only the `parent=` keys are read (the content of the files never reaches the
 * browser), so the answer stays small even for a big project.
 */
export const COUNT_CHILDREN_COMMAND =
  "grep -rh --include='task_*.txt' --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg '^parent=' . | cut -d= -f2 | sort | uniq -c";

/**
 * Command used to read the hierarchy of the tasks.
 *
 * Only the `parent=` lines are read and the name of the file is printed in
 * front of them (`-H`), so the answer stays small: one short line per child
 * task.
 */
export const READ_PARENTS_COMMAND =
  "grep -rH --include='task_*.txt' --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg -e '^parent=' .";

/**
 * Command used to read the metadata of every task.
 *
 * Everything the board and the Gantt chart need is read in one command: the
 * parent of every task, its status, its title, its tags and its dates.
 */
export const READ_METADATA_COMMAND =
  "grep -rH --include='task_*.txt' --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg -e '^id=' -e '^parent=' -e '^status=' -e '^title=' -e '^tags=' -e '^start=' -e '^end=' .";

/** Command used to list the task files that are children of a given task. */
export function childrenCommand(parentId: number): string {
  return `grep -rl --include='task_*.txt' --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg -e '^parent=${parentId}$' .`;
}

/** The metadata of a task, as it is read in one command. */
export interface TaskMetadata {
  readonly id: number;
  readonly title: string;
  readonly status: TaskStatus;
  readonly parentId: number | null;
  readonly start: string;
  readonly end: string;
  readonly tags: readonly string[];
  readonly path: string;
}

/** The structure of the tasks of a project folder. */
export interface TaskHierarchy {
  /** Id of every task -> id of its parent (`null` for a task without parent). */
  readonly parents: ReadonlyMap<number, number | null>;
  /** Path of the file of every task. */
  readonly paths: ReadonlyMap<number, string>;
}

/** The metadata of a task, while it is being read. */
interface MutableMetadata {
  title: string;
  status: TaskStatus;
  parentId: number | null;
  start: string;
  end: string;
  tags: string[];
}

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

  /** Creates a new task file, optionally as a child of another task. */
  async createTask(
    projectDir: string,
    input: TaskInput,
    parentId: number | null = null,
  ): Promise<Task> {
    if (parentId !== null) {
      const parentPath = joinPath(projectDir, taskFileName(parentId));
      if (!(await this.api.fileExists(parentPath))) {
        throw new Error(`The parent task #${parentId} does not exist in "${projectDir}".`);
      }
    }

    let id = await this.nextTaskId(projectDir);

    // The id must be unique: retry with the next one when the file already exists.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const path = joinPath(projectDir, taskFileName(id));
      const task = buildTask(input, id, new Date(), parentId);
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

  /**
   * Reads the hierarchy of every task of the project folder.
   *
   * Two calls are needed: the listing of the task files (the id of a task is
   * encoded in its file name) and a `grep` of the `parent=` lines (the parent
   * of a task). The content of the files never reaches the browser here, only
   * the structure of the tasks.
   */
  async readHierarchy(projectDir: string): Promise<TaskHierarchy> {
    const [paths, result] = await Promise.all([
      this.listTaskFilePaths(projectDir),
      this.api.execShell({
        command: READ_PARENTS_COMMAND,
        cwd: projectDir,
        timeout: 60,
      }),
    ]);
    if (result.returncode !== 0 && result.returncode !== 1) {
      throw new Error(
        `Unable to read the hierarchy of "${projectDir}": ${result.stderr.trim() || `exit code ${result.returncode}`}`,
      );
    }

    const parentsByPath = this.parseParents(result.stdout, projectDir);
    const parents = new Map<number, number | null>();
    const taskPaths = new Map<number, string>();

    for (const path of paths) {
      const id = parseTaskIdFromFileName(path.slice(path.lastIndexOf('/') + 1));
      if (id === null) {
        continue;
      }
      parents.set(id, parentsByPath.get(path) ?? null);
      taskPaths.set(id, path);
    }

    return { parents, paths: taskPaths };
  }

  /** Amount of children of every task, indexed by the id of the parent. */
  async childCounts(projectDir: string): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    const result = await this.api.execShell({
      command: COUNT_CHILDREN_COMMAND,
      cwd: projectDir,
      timeout: 60,
    });
    if (result.returncode !== 0 && result.returncode !== 1) {
      throw new Error(
        `Unable to count the children of "${projectDir}": ${result.stderr.trim() || `exit code ${result.returncode}`}`,
      );
    }
    for (const line of result.stdout.split('\n')) {
      const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
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

  /** Paths of the task files that are children of the given task. */
  async findChildrenPaths(projectDir: string, parentId: number): Promise<string[]> {
    const result = await this.api.execShell({
      command: childrenCommand(parentId),
      cwd: projectDir,
      timeout: 60,
    });
    if (result.returncode !== 0 && result.returncode !== 1) {
      throw new Error(
        `Unable to list the children of the task #${parentId}: ${result.stderr.trim() || `exit code ${result.returncode}`}`,
      );
    }
    return this.parsePaths(result.stdout, projectDir);
  }

  /** The tasks that are children of the given task. */
  async findChildren(projectDir: string, parentId: number): Promise<Task[]> {
    const paths = await this.findChildrenPaths(projectDir, parentId);
    const children: Task[] = [];
    for (const path of paths) {
      try {
        children.push(await this.loadTask(path));
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          continue;
        }
        throw error;
      }
    }
    return children;
  }

  /** Updates an existing task file, keeping its id and creation time. */
  async updateTask(path: string, changes: TaskInput): Promise<Task> {
    const current = await this.loadTask(path);
    const updated = applyTaskInput(current, changes, new Date());
    await this.api.overwriteFile(path, serializeTask(updated));
    return updated;
  }

  /**
   * Reads the metadata of every task of the project folder.
   *
   * Two calls are needed: the listing of the task files (the id of a task is
   * encoded in its file name) and a `grep` of the metadata of the tasks. The
   * content of the files never reaches the browser here, only the metadata.
   */
  async readTaskMetadata(projectDir: string): Promise<Map<number, TaskMetadata>> {
    const [paths, result] = await Promise.all([
      this.listTaskFilePaths(projectDir),
      this.api.execShell({
        command: READ_METADATA_COMMAND,
        cwd: projectDir,
        timeout: 60,
      }),
    ]);
    if (result.returncode !== 0 && result.returncode !== 1) {
      throw new Error(
        `Unable to read the tasks of "${projectDir}": ${result.stderr.trim() || `exit code ${result.returncode}`}`,
      );
    }

    const metadata = this.parseMetadata(result.stdout, projectDir);
    const tasks = new Map<number, TaskMetadata>();

    for (const path of paths) {
      const id = parseTaskIdFromFileName(path.slice(path.lastIndexOf('/') + 1));
      if (id === null) {
        continue;
      }
      const values = metadata.get(path);
      if (values === undefined) {
        continue;
      }
      tasks.set(id, {
        id,
        title: values.title,
        status: values.status,
        parentId: values.parentId,
        start: values.start,
        end: values.end,
        tags: values.tags,
        path,
      });
    }
    return tasks;
  }

  /**
   * Reads the cards of the board: the tasks that have **no child**.
   *
   * The metadata of every task is read in one command: the content of the
   * files never reaches the browser here, only the status, the title and the
   * tags of the tasks that have no child.
   */
  async readLeafTasks(projectDir: string): Promise<TaskCard[]> {
    const metadata = await this.readTaskMetadata(projectDir);

    const parents = new Set<number>();
    for (const values of metadata.values()) {
      if (values.parentId !== null) {
        parents.add(values.parentId);
      }
    }

    const cards: TaskCard[] = [];
    for (const values of metadata.values()) {
      if (parents.has(values.id)) {
        // The task has a child: it does not belong to the board.
        continue;
      }
      cards.push({
        id: values.id,
        title: values.title,
        status: values.status,
        parentId: values.parentId,
        tags: values.tags,
        path: values.path,
      });
    }
    return cards;
  }

  /**
   * Moves a task under another parent.
   *
   * A `null` parent makes the task a root task again. Only the `parent=` key of
   * the file changes, the rest of the task is kept.
   */
  async setParent(path: string, parentId: number | null): Promise<Task> {
    const current = await this.loadTask(path);
    const updated = withParent(current, parentId, new Date());
    await this.api.overwriteFile(path, serializeTask(updated));
    return updated;
  }

  /** Changes the status of a task. */
  async setStatus(path: string, status: TaskStatus): Promise<Task> {
    const current = await this.loadTask(path);
    const updated = withStatus(current, status, new Date());
    await this.api.overwriteFile(path, serializeTask(updated));
    return updated;
  }

  /** Changes the start and the end date of a task. */
  async setDates(path: string, start: string, end: string): Promise<Task> {
    const current = await this.loadTask(path);
    const updated = withDates(current, start, end, new Date());
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

  /**
   * Parses the output of the command that reads the metadata of the tasks.
   *
   * Every line looks like `./task_5.txt:title=The task`. The path may contain
   * a colon, so the last colon that is followed by a known key is the
   * separator.
   */
  private parseMetadata(stdout: string, projectDir: string): Map<string, MutableMetadata> {
    const metadata = new Map<string, MutableMetadata>();
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const match = /^(.*):(id|parent|status|title|tags|start|end)=(.*)$/u.exec(trimmed);
      if (match === null) {
        continue;
      }
      const relative = match[1] ?? '';
      const key = match[2] ?? '';
      const value = match[3] ?? '';
      if (relative.length === 0) {
        continue;
      }
      const path = joinPath(projectDir, relative);
      const current = metadata.get(path) ?? {
        title: '',
        status: 'todo',
        parentId: null,
        start: '',
        end: '',
        tags: [],
      };
      if (key === 'title') {
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
      }
      metadata.set(path, current);
    }
    return metadata;
  }

  /**
   * Parses the output of `grep -rH -e '^parent='`.
   *
   * Every line looks like `./sub/task_5.txt:parent=3`. The path may contain a
   * colon, so the last colon that is followed by the key is the separator.
   */
  private parseParents(stdout: string, projectDir: string): Map<string, number> {
    const parents = new Map<string, number>();
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const match = /^(.*):parent=(\d+)$/u.exec(trimmed);
      if (match === null) {
        continue;
      }
      const relative = match[1] ?? '';
      const parentId = Number.parseInt(match[2] ?? '', 10);
      if (relative.length === 0 || !Number.isSafeInteger(parentId)) {
        continue;
      }
      parents.set(joinPath(projectDir, relative), parentId);
    }
    return parents;
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
