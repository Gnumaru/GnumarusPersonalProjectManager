/**
 * Application configuration.
 *
 * The configuration is stored in `~/.config/GnumarusProjectManager/config.json`
 * and is written through the low level operations service, so it survives a
 * browser cache wipe and can be shared by different browsers.
 *
 * An **embedded** project lives in the browser: its configuration is kept in
 * the local storage of the browser instead. A project that lives in a folder
 * of the disk, reached through the **File System Access API**, is kept in the
 * local storage as well: the application cannot write outside of the folder
 * the user chose.
 */

import { ApiClient } from '../api/client.js';
import type { ProjectKind } from './projectStore.js';
import { supportsOpfs } from './browserStorage.js';
import { supportsFileSystemAccess } from './fileSystemAccess.js';

export const CONFIG_DIRECTORY = '~/.config/GnumarusProjectManager';
export const CONFIG_FILE_PATH = '~/.config/GnumarusProjectManager/config.json';

/** The key that holds the kind of storage of the project. */
export const MODE_STORAGE_KEY = 'gnumarus-project-manager.mode';

/**
 * The key that holds the configuration of a project that lives in the browser.
 *
 * It holds the configuration of the embedded project and the one of the
 * project of the File System Access API: neither of them can be written in
 * the configuration file of the machine.
 */
export const BROWSER_CONFIG_STORAGE_KEY = 'gnumarus-project-manager.config';

/**
 * The storage the configuration is kept in.
 *
 * `window.localStorage` satisfies it; keeping the contract small avoids
 * depending on the whole `Storage` interface.
 */
export interface ConfigStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AppConfig {
  /** The kind of storage the project uses. */
  readonly mode: ProjectKind;
  /** The folder of the project, `null` in the embedded mode. */
  readonly projectDir: string | null;
  /** Amount of tasks shown per page. */
  readonly pageSize: number;
  /** Amount of notes shown per page, from 10 to 100. */
  readonly notePageSize: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  mode: 'service',
  projectDir: null,
  pageSize: 10,
  notePageSize: 10,
};

/** The smallest amount of notes a page can hold. */
export const MIN_NOTE_PAGE_SIZE = 10;

/** The biggest amount of notes a page can hold. */
export const MAX_NOTE_PAGE_SIZE = 100;

/** Keeps the amount of notes per page inside the allowed range. */
export function clampNotePageSize(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_CONFIG.notePageSize;
  }
  const truncated = Math.trunc(value);
  if (truncated < MIN_NOTE_PAGE_SIZE) {
    return MIN_NOTE_PAGE_SIZE;
  }
  if (truncated > MAX_NOTE_PAGE_SIZE) {
    return MAX_NOTE_PAGE_SIZE;
  }
  return truncated;
}

/** The local storage of the browser, `null` when there is none. */
function browserStorage(): ConfigStorage | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    return localStorage;
  } catch {
    // The browser refuses to give the local storage.
    return null;
  }
}

/**
 * The kind of storage the application uses when the user has not chosen one.
 *
 * The **File System Access API** comes first: it gives the application the
 * files of a folder of the disk, without the low level service. The **OPFS**
 * comes next, and the **Gnumarus OS Bridge service** is the last choice: it is
 * the only one that works everywhere.
 */
export function defaultMode(win: Window | null = null): ProjectKind {
  if (supportsFileSystemAccess(win ?? globalWindow())) {
    return 'filesystem';
  }
  if (supportsOpfs(win ?? globalWindow())) {
    return 'embedded';
  }
  return 'service';
}

/** The window of the page, `null` when there is none. */
function globalWindow(): Window | null {
  try {
    return typeof window === 'undefined' ? null : window;
  } catch {
    return null;
  }
}

/** True when the value is an object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Parses the configuration, falling back to the defaults for invalid values. */
export function parseConfig(content: string): AppConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return DEFAULT_CONFIG;
  }
  if (!isRecord(parsed)) {
    return DEFAULT_CONFIG;
  }

  const mode = parsed['mode'];
  const projectDir = parsed['projectDir'];
  const pageSize = parsed['pageSize'];
  const notePageSize = parsed['notePageSize'];

  return {
    mode: isProjectKind(mode) ? mode : 'service',
    projectDir: typeof projectDir === 'string' && projectDir.length > 0 ? projectDir : null,
    pageSize:
      typeof pageSize === 'number' && Number.isFinite(pageSize) && pageSize > 0
        ? Math.trunc(pageSize)
        : DEFAULT_CONFIG.pageSize,
    notePageSize:
      typeof notePageSize === 'number' && Number.isFinite(notePageSize)
        ? clampNotePageSize(notePageSize)
        : DEFAULT_CONFIG.notePageSize,
  };
}

/** True when the value is one of the kinds of storage. */
export function isProjectKind(value: unknown): value is ProjectKind {
  return value === 'service' || value === 'embedded' || value === 'filesystem';
}

/** Serializes the configuration as pretty printed JSON. */
export function serializeConfig(config: AppConfig): string {
  return `${JSON.stringify(
    {
      mode: config.mode,
      projectDir: config.projectDir,
      pageSize: config.pageSize,
      notePageSize: config.notePageSize,
    },
    null,
    2,
  )}\n`;
}

/**
 * The kind of storage the user chose.
 *
 * When the browser knows nothing about a project that was opened before, the
 * default of the browser is used.
 */
export function readMode(storage?: ConfigStorage | null, win?: Window | null): ProjectKind {
  const store = storage ?? browserStorage();
  if (store !== null) {
    try {
      const value = store.getItem(MODE_STORAGE_KEY);
      if (isProjectKind(value)) {
        return value;
      }
    } catch {
      // The browser refuses to give the local storage.
    }
  }
  return defaultMode(win);
}

/** Remembers the kind of storage the user chose. */
export function writeMode(mode: ProjectKind, storage?: ConfigStorage | null): void {
  const store = storage ?? browserStorage();
  if (store === null) {
    return;
  }
  try {
    store.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // The browser refuses to keep the mode: it is asked again next time.
  }
}

/**
 * Reads the configuration file, returning the defaults when it is missing.
 *
 * The projects that live in the browser keep their configuration in the local
 * storage of the browser.
 */
export async function loadConfig(
  api: ApiClient,
  mode: ProjectKind,
  storage?: ConfigStorage | null,
): Promise<AppConfig> {
  if (mode !== 'service') {
    return loadBrowserConfig(mode, storage);
  }
  try {
    const file = await api.readFile(CONFIG_FILE_PATH);
    return parseConfig(file.content);
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Writes the configuration file, creating the directory when needed. */
export async function saveConfig(
  api: ApiClient,
  config: AppConfig,
  storage?: ConfigStorage | null,
): Promise<void> {
  if (config.mode !== 'service') {
    saveBrowserConfig(config, storage);
    return;
  }
  await api.execShell({
    command: 'mkdir -p -- "$HOME/.config/GnumarusProjectManager"',
    timeout: 10,
  });
  await api.overwriteFile(CONFIG_FILE_PATH, serializeConfig(config));
}

/** Reads the configuration of a project that lives in the browser. */
function loadBrowserConfig(mode: ProjectKind, storage?: ConfigStorage | null): AppConfig {
  const store = storage ?? browserStorage();
  if (store === null) {
    return { ...DEFAULT_CONFIG, mode };
  }
  try {
    const raw = store.getItem(BROWSER_CONFIG_STORAGE_KEY);
    if (raw === null) {
      return { ...DEFAULT_CONFIG, mode };
    }
    return { ...parseConfig(raw), mode };
  } catch {
    return { ...DEFAULT_CONFIG, mode };
  }
}

/** Writes the configuration of a project that lives in the browser. */
function saveBrowserConfig(config: AppConfig, storage?: ConfigStorage | null): void {
  const store = storage ?? browserStorage();
  if (store === null) {
    return;
  }
  try {
    store.setItem(
      BROWSER_CONFIG_STORAGE_KEY,
      JSON.stringify({
        projectDir: null,
        pageSize: config.pageSize,
        notePageSize: config.notePageSize,
      }),
    );
  } catch {
    // The browser refuses to keep the configuration: it is asked again next time.
  }
}
