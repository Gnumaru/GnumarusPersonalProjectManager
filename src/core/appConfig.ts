/**
 * Global settings of the application, kept in a `config.txt` file.
 *
 * The file lives in the project folder, next to the task files. It holds
 * global settings as `key=value` metadata in the same format as the other
 * files, but it has no description section: only the metadata block.
 *
 * ```
 * view=kanban
 * kanban_show_all_hidden=true
 * kanban_show_hidden_todo=true
 * ```
 *
 * A key that is absent means its default: the board shows nothing hidden and
 * the app opens in the list view. Only the keys that differ from the defaults
 * are written.
 */

import { TASK_STATUSES, type TaskStatus } from './task.js';
import { parseMetadataBlock } from './task.js';

/** Name of the configuration file, relative to the project folder. */
export const APP_CONFIG_FILE = 'config.txt';

/** The views of the application, in the order of the toolbar. */
export const VIEW_MODES = ['list', 'tree', 'kanban', 'gantt', 'notes'] as const;

/** One of the views of the application. */
export type AppView = (typeof VIEW_MODES)[number];

/** Global settings of the application. */
export interface GlobalConfig {
  /** The view the app reopens in, `null` for the default list view. */
  readonly view: AppView | null;
  /** The task the tree view is focused on, `null` for the general root. */
  readonly focusTree: number | null;
  /** The task the Gantt chart is focused on, `null` for the general root. */
  readonly focusGantt: number | null;
  /** Shows the hidden cards of every Kanban column. */
  readonly showAllHidden: boolean;
  /** Per Kanban column toggle, `false` when the column is absent. */
  readonly showHiddenByStatus: ReadonlyMap<TaskStatus, boolean>;
  /** Shows the hidden rows of the tree view and the Gantt chart. */
  readonly treeGanttShowHidden: boolean;
}

/** The default settings: list view, no focus, nothing hidden is shown. */
export const EMPTY_GLOBAL_CONFIG: GlobalConfig = {
  view: null,
  focusTree: null,
  focusGantt: null,
  showAllHidden: false,
  showHiddenByStatus: new Map<TaskStatus, boolean>(),
  treeGanttShowHidden: false,
};

function columnKey(status: TaskStatus): string {
  return `kanban_show_hidden_${status}`;
}

function isStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

function isView(value: string): value is AppView {
  return (VIEW_MODES as readonly string[]).includes(value);
}

function parseTaskId(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const id = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Reads the settings from the content of a `config.txt` file. */
export function parseGlobalConfig(content: string): GlobalConfig {
  const { metadata } = parseMetadataBlock(content);
  const rawView = (metadata.get('view') ?? '').trim();
  const view = isView(rawView) ? rawView : null;
  const showAllHidden = (metadata.get('kanban_show_all_hidden') ?? '').trim().toLowerCase() === 'true';
  const treeGanttShowHidden =
    (metadata.get('tree_gantt_show_hidden') ?? '').trim().toLowerCase() === 'true';
  const focusTree = parseTaskId(metadata.get('focus_tree'));
  const focusGantt = parseTaskId(metadata.get('focus_gantt'));
  const showHiddenByStatus = new Map<TaskStatus, boolean>();
  for (const [key, value] of metadata) {
    if (!key.startsWith('kanban_show_hidden_')) {
      continue;
    }
    const status = key.slice('kanban_show_hidden_'.length);
    if (!isStatus(status)) {
      continue;
    }
    if (value.trim().toLowerCase() === 'true') {
      showHiddenByStatus.set(status, true);
    }
  }
  return { view, focusTree, focusGantt, showAllHidden, treeGanttShowHidden, showHiddenByStatus };
}

/** Serializes the settings into the content of a `config.txt` file. */
export function serializeGlobalConfig(config: GlobalConfig): string {
  const lines: string[] = [];
  if (config.view !== null) {
    lines.push(`view=${config.view}`);
  }
  if (config.focusTree !== null) {
    lines.push(`focus_tree=${config.focusTree}`);
  }
  if (config.focusGantt !== null) {
    lines.push(`focus_gantt=${config.focusGantt}`);
  }
  if (config.showAllHidden) {
    lines.push('kanban_show_all_hidden=true');
  }
  if (config.treeGanttShowHidden) {
    lines.push('tree_gantt_show_hidden=true');
  }
  const statuses = [...config.showHiddenByStatus.keys()].sort();
  for (const status of statuses) {
    if (config.showHiddenByStatus.get(status) === true) {
      lines.push(`${columnKey(status)}=true`);
    }
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}
