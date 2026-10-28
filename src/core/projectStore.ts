/**
 * The facade of the storage of a project.
 *
 * A project is a set of text files: one file per task (`task_<id>.txt`) and one
 * file per comment (`comment_<id>.txt`). The application never talks to the
 * storage directly: it goes through this interface, which has two
 * implementations:
 *
 * * `ServiceProjectStore` - the files live on the disk of the machine and are
 *   reached through the low level operations service (the shell is used to list
 *   and to search the files);
 * * `EmbeddedProjectStore` - the files live in the browser (the Origin Private
 *   File System, or an IndexedDB when the OPFS is not available) and everything
 *   is computed in the browser.
 *
 * The paths are always **relative** to the project folder, so the two
 * implementations agree on the names of the files.
 */

import type { TaskComment } from './comment.js';
import type { Note, NoteSearchScope } from './note.js';
import type { Task, TaskStatus } from './task.js';

/** The kind of storage a project uses. */
export type ProjectKind = 'service' | 'embedded' | 'filesystem';

/**
 * The metadata of a task, without its description.
 *
 * It holds everything the tree, the board and the Gantt chart need, and
 * nothing else: the description of a task is only read when the task itself
 * is displayed.
 */
export interface TaskSummary {
  readonly id: number;
  readonly title: string;
  readonly status: TaskStatus;
  readonly parentId: number | null;
  readonly tags: readonly string[];
  readonly start: string;
  readonly end: string;
  /** The timestamp of the last update, empty when unknown. */
  readonly updated: string;
  /**
   * Whether the branch of the task is expanded in the tree view.
   *
   * Only the tree and the Gantt views read it; the other views ignore it.
   */
  readonly expanded: boolean;
  /** Order of the task in the Kanban view. */
  readonly kanbanOrder: number;
  /** Whether the card is hidden on the Kanban board. */
  readonly kanbanHidden: boolean;
  /** Whether the task is hidden in the tree view and the Gantt chart. */
  readonly treeGanttHidden: boolean;
  /** Order of the task in the tree view and in the Gantt chart. */
  readonly treeGanttOrder: number;
  /** The path of the file, relative to the project folder. */
  readonly path: string;
}

/** A file of the project. */
export interface ProjectFile {
  /** The path of the file, relative to the project folder. */
  readonly path: string;
  readonly content: string;
}

/** The structure of the tasks of a project. */
export interface TaskHierarchy {
  /** Id of every task -> id of its parent (`null` for a task without parent). */
  readonly parents: ReadonlyMap<number, number | null>;
  /** Path of the file of every task, relative to the project folder. */
  readonly paths: ReadonlyMap<number, string>;
}

/** The metadata of a note: everything the listing needs, and nothing more. */
export interface NoteSummary {
  /** Unique incremental integer, also encoded in the file name. */
  readonly id: number;
  readonly title: string;
  /** The timestamp of the last update, empty when unknown. */
  readonly updated: string;
  /** The path of the file, relative to the project folder. */
  readonly path: string;
}

export interface ProjectStore {
  /** The kind of storage this store uses. */
  readonly kind: ProjectKind;

  /** The paths of the task files, sorted by task id. */
  listTaskPaths(): Promise<readonly string[]>;

  /** The paths of the task files whose content matches the term. */
  searchTaskPaths(term: string): Promise<readonly string[]>;

  /** The metadata of every task of the project. */
  listTasks(): Promise<readonly TaskSummary[]>;

  /** The metadata of every note of the project. */
  listNoteSummaries(): Promise<readonly NoteSummary[]>;

  /** The amount of children of every task, indexed by the id of the parent. */
  childCounts(): Promise<ReadonlyMap<number, number>>;

  /** The amount of comments of every task, indexed by the id of the task. */
  commentCounts(): Promise<ReadonlyMap<number, number>>;

  /** The full task held by a file. */
  readTask(path: string): Promise<Task>;

  /** Writes a task file, replacing the previous content. */
  writeTask(path: string, task: Task): Promise<void>;

  /** Creates a task file, failing when the file already exists. */
  createTaskFile(path: string, task: Task): Promise<void>;

  /** Deletes a file of the project. */
  deleteFile(path: string): Promise<void>;

  /** The comments of a task, the most recent first. */
  listComments(taskId: number): Promise<readonly TaskComment[]>;

  /** Creates a comment on a task. */
  createComment(taskId: number, text: string): Promise<TaskComment>;

  /** Writes a comment file, replacing the previous content. */
  writeComment(comment: TaskComment): Promise<void>;

  /** Deletes a comment file. */
  deleteComment(path: string): Promise<void>;

  /** The paths of the note files, sorted by note id. */
  listNotePaths(): Promise<readonly string[]>;

  /** The paths of the note files whose title or content matches the term. */
  searchNotePaths(term: string, scope: NoteSearchScope): Promise<readonly string[]>;

  /** The full note held by a file. */
  readNote(path: string): Promise<Note>;

  /** Writes a note file, replacing the previous content. */
  writeNote(path: string, note: Note): Promise<void>;

  /** Creates a note file, failing when the file already exists. */
  createNoteFile(path: string, note: Note): Promise<void>;

  /** The id that the next note will take. */
  nextNoteId(): Promise<number>;

  /** The path of the file of a note, relative to the project folder. */
  notePath(id: number): string;

  /** The id that the next task will take. */
  nextTaskId(): Promise<number>;

  /** The id that the next comment will take. */
  nextCommentId(): Promise<number>;

  /** The path of the file of a task, relative to the project folder. */
  taskPath(id: number): string;

  /** The path of the file of a comment, relative to the project folder. */
  commentPath(id: number): string;

  /** Raw content of `config.txt`, `null` when the file does not exist. */
  readAppConfig(): Promise<string | null>;

  /** Writes `config.txt`, creating or replacing it. */
  writeAppConfig(content: string): Promise<void>;

  /** Every file of the project: the export of the ZIP archive. */
  listFiles(): Promise<readonly ProjectFile[]>;

  /** Replaces the whole content of the project: the import of a ZIP archive. */
  replaceAll(files: readonly ProjectFile[]): Promise<void>;
}
