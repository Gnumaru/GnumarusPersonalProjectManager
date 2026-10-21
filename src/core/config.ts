/**
 * Application configuration.
 *
 * The configuration is stored in `~/.config/GnumarusProjectManager/config.json`
 * and is written through the low level operations service, so it survives a
 * browser cache wipe and can be shared by different browsers.
 */

import { ApiClient } from '../api/client.js';

export const CONFIG_DIRECTORY = '~/.config/GnumarusProjectManager';
export const CONFIG_FILE_PATH = '~/.config/GnumarusProjectManager/config.json';

export interface AppConfig {
  /** Directory that holds the task files. */
  readonly projectDir: string | null;
  /** Amount of tasks shown per page. */
  readonly pageSize: number;
}

export const DEFAULT_CONFIG: AppConfig = {
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

  const projectDir = parsed['projectDir'];
  const pageSize = parsed['pageSize'];

  return {
    projectDir: typeof projectDir === 'string' && projectDir.length > 0 ? projectDir : null,
    pageSize:
      typeof pageSize === 'number' && Number.isFinite(pageSize) && pageSize > 0
        ? Math.trunc(pageSize)
        : DEFAULT_CONFIG.pageSize,
  };
}

/** Serializes the configuration as pretty printed JSON. */
export function serializeConfig(config: AppConfig): string {
  return `${JSON.stringify({ projectDir: config.projectDir, pageSize: config.pageSize }, null, 2)}\n`;
}

/** Reads the configuration file, returning the defaults when it is missing. */
export async function loadConfig(api: ApiClient): Promise<AppConfig> {
  try {
    const file = await api.readFile(CONFIG_FILE_PATH);
    return parseConfig(file.content);
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Writes the configuration file, creating the directory when needed. */
export async function saveConfig(api: ApiClient, config: AppConfig): Promise<void> {
  await api.execShell({
    command: 'mkdir -p "$HOME/.config/GnumarusProjectManager"',
    timeout: 10,
  });
  await api.writeFileEnsuring(CONFIG_FILE_PATH, serializeConfig(config));
}
