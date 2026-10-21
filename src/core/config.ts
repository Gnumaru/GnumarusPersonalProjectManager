/**
 * Application configuration.
 *
 * The configuration is stored in `~/.config/GnumarusProjectManager/config.json`
 * and is written through the low level operations service, so it survives a
 * browser cache wipe and can be shared by different browsers.
 *
 * An **embedded** project lives in the browser: its configuration is kept in
 * the local storage of the browser instead.
 */

import { ApiClient } from '../api/client.js';
import type { ProjectKind } from './projectStore.js';

export const CONFIG_DIRECTORY = '~/.config/GnumarusProjectManager';
export const CONFIG_FILE_PATH = '~/.config/GnumarusProjectManager/config.json';

/** The key that holds the kind of storage of the project. */
export const MODE_STORAGE_KEY = 'gnumarus-project-manager.mode';

/** The key that holds the configuration of an embedded project. */
export const EMBEDDED_CONFIG_STORAGE_KEY = 'gnumarus-project-manager.config';

export interface AppConfig {
  /** The kind of storage the project uses. */
  readonly mode: ProjectKind;
  /** The folder of the project, `null` in the embedded mode. */
  readonly projectDir: string | null;
  /** Amount of tasks shown per page. */
  readonly pageSize: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  mode: 'service',
  projectDir: null,
  pageSize: 10,
};

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

  return {
    mode: mode === 'embedded' ? 'embedded' : 'service',
    projectDir: typeof projectDir === 'string' && projectDir.length > 0 ? projectDir : null,
    pageSize:
      typeof pageSize === 'number' && Number.isFinite(pageSize) && pageSize > 0
        ? Math.trunc(pageSize)
        : DEFAULT_CONFIG.pageSize,
  };
}

/** Serializes the configuration as pretty printed JSON. */
export function serializeConfig(config: AppConfig): string {
  return `${JSON.stringify(
    { mode: config.mode, projectDir: config.projectDir, pageSize: config.pageSize },
    null,
    2,
  )}\n`;
}

/** The kind of storage the user chose. */
export function readMode(): ProjectKind {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === 'embedded' ? 'embedded' : 'service';
  } catch {
    return 'service';
  }
}

/** Remembers the kind of storage the user chose. */
export function writeMode(mode: ProjectKind): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // The browser refuses to keep the mode: it is asked again next time.
  }
}

/** Reads the configuration file, returning the defaults when it is missing. */
export async function loadConfig(api: ApiClient, mode: ProjectKind): Promise<AppConfig> {
  if (mode === 'embedded') {
    return loadEmbeddedConfig();
  }
  try {
    const file = await api.readFile(CONFIG_FILE_PATH);
    return parseConfig(file.content);
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Writes the configuration file, creating the directory when needed. */
export async function saveConfig(api: ApiClient, config: AppConfig): Promise<void> {
  if (config.mode === 'embedded') {
    saveEmbeddedConfig(config);
    return;
  }
  await api.execShell({
    command: 'mkdir -p -- "$HOME/.config/GnumarusProjectManager"',
    timeout: 10,
  });
  await api.overwriteFile(CONFIG_FILE_PATH, serializeConfig(config));
}

/** Reads the configuration of the embedded project. */
function loadEmbeddedConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(EMBEDDED_CONFIG_STORAGE_KEY);
    if (raw === null) {
      return { ...DEFAULT_CONFIG, mode: 'embedded' };
    }
    return { ...parseConfig(raw), mode: 'embedded' };
  } catch {
    return { ...DEFAULT_CONFIG, mode: 'embedded' };
  }
}

/** Writes the configuration of the embedded project. */
function saveEmbeddedConfig(config: AppConfig): void {
  try {
    localStorage.setItem(
      EMBEDDED_CONFIG_STORAGE_KEY,
      JSON.stringify({ projectDir: null, pageSize: config.pageSize }),
    );
  } catch {
    // The browser refuses to keep the configuration: it is asked again next time.
  }
}
