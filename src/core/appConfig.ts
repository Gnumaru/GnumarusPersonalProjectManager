/**
 * Global settings of the application, kept in a `config.txt` file.
 *
 * The file lives in the project folder, next to the task files. It holds
 * global settings as `key=value` metadata in the same format as the other
 * files, but it has no description section: only the metadata block.
 *
 * ```
 * kanban_show_all_hidden=true
 * kanban_show_hidden_todo=true
 * ```
 *
 * A key that is absent means `false`, so a default configuration is an empty
 * file. Only the keys that are `true` are written.
 */

import { TASK_STATUSES, type TaskStatus } from './task.js';
import { parseMetadataBlock } from './task.js';

/** Name of the configuration file, relative to the project folder. */
export const APP_CONFIG_FILE = 'config.txt';

/** Global settings of the application. */
export interface GlobalConfig {
  /** Shows the hidden cards of every Kanban column. */
  readonly showAllHidden: boolean;
  /** Per Kanban column toggle, `false` when the column is absent. */
  readonly showHiddenByStatus: ReadonlyMap<TaskStatus, boolean>;
}

/** The default settings: nothing hidden is shown. */
export const EMPTY_GLOBAL_CONFIG: GlobalConfig = {
  showAllHidden: false,
  showHiddenByStatus: new Map<TaskStatus, boolean>(),
};

function columnKey(status: TaskStatus): string {
  return `kanban_show_hidden_${status}`;
}

function isStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

/** Reads the settings from the content of a `config.txt` file. */
export function parseGlobalConfig(content: string): GlobalConfig {
  const { metadata } = parseMetadataBlock(content);
  const showAllHidden = (metadata.get('kanban_show_all_hidden') ?? '').trim().toLowerCase() === 'true';
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
  return { showAllHidden, showHiddenByStatus };
}

/** Serializes the settings into the content of a `config.txt` file. */
export function serializeGlobalConfig(config: GlobalConfig): string {
  const lines: string[] = [];
  if (config.showAllHidden) {
    lines.push('kanban_show_all_hidden=true');
  }
  const statuses = [...config.showHiddenByStatus.keys()].sort();
  for (const status of statuses) {
    if (config.showHiddenByStatus.get(status) === true) {
      lines.push(`${columnKey(status)}=true`);
    }
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}
