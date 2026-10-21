/**
 * REST client for the GnumarusOSBridge low level operations service.
 *
 * Every endpoint but `/api/help` may require the token generated when the
 * service starts. The token is provided by the user through the application
 * interface and kept in `localStorage` (ephemeral data, same nature as the RAM
 * of a native application).
 *
 * The service can also be started with the flag that disables the token
 * requirement. The client discovers it through the `auth` block published by
 * `/api/help` and, when the help page says nothing about it, by probing a
 * protected route without a token (see `fetchServiceStatus`).
 */

export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:1423';

export type DirectoryEntryType = 'file' | 'dir' | 'symlink' | 'other';

export interface DirectoryEntry {
  readonly name: string;
  readonly path: string;
  readonly type: DirectoryEntryType;
  readonly size: number;
  /** Epoch seconds. */
  readonly mtime: number;
}

export interface ShellRequest {
  readonly command: string;
  readonly cwd?: string;
  readonly stdin?: string;
  readonly timeout?: number;
}

export interface ShellResult {
  readonly command: string;
  readonly cwd: string;
  readonly returncode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export interface FileContent {
  readonly path: string;
  readonly absolutePath: string;
  readonly content: string;
  readonly size: number;
  readonly isBinary: boolean;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Error raised when the service cannot be reached at all. */
export class ApiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiUnavailableError';
  }
}

/**
 * Authentication policy of the service.
 *
 * `true` when the service demands a token on every route but the open ones,
 * `false` when it was started with the flag that disables the token and `null`
 * when the policy could not be determined.
 */
export type AuthRequirement = boolean | null;

/** What the client knows about the running service. */
export interface ServiceStatus {
  /** `false` when the service cannot be reached at all. */
  readonly available: boolean;
  /** Whether the service demands a token. */
  readonly authRequired: AuthRequirement;
  /** Version of the service, when it announced one. */
  readonly version: string | null;
}

/** The parts of the `/api/help` payload the application cares about. */
export interface ServiceInfo {
  readonly version: string | null;
  readonly authRequired: AuthRequirement;
  readonly openRoutes: readonly string[];
}

export interface ApiClientOptions {
  readonly baseUrl?: string;
  readonly token?: string | null;
  readonly fetchImpl?: typeof fetch;
}

interface RawDirectoryEntry {
  readonly name?: unknown;
  readonly path?: unknown;
  readonly type?: unknown;
  readonly size?: unknown;
  readonly mtime?: unknown;
}

interface RawFileResponse {
  readonly path?: unknown;
  readonly absolute_path?: unknown;
  readonly content?: unknown;
  readonly size?: unknown;
  readonly is_binary?: unknown;
}

interface RawShellResponse {
  readonly command?: unknown;
  readonly cwd?: unknown;
  readonly returncode?: unknown;
  readonly stdout?: unknown;
  readonly stderr?: unknown;
  readonly timed_out?: unknown;
  readonly stdout_truncated?: unknown;
  readonly stderr_truncated?: unknown;
}

const TAGGED_PATTERN = /^(i|f|s|b):([\s\S]*)$/u;

/**
 * Decodes the tagged scalar convention used by the service: numbers, booleans
 * and null travel as strings (`i:12`, `f:1.5`, `b:true`, `null`).
 */
export function decodeTagged(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  if (value === 'null') {
    return null;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  const match = TAGGED_PATTERN.exec(value);
  if (match === null) {
    return value;
  }
  const kind = match[1];
  const raw = match[2] ?? '';
  if (kind === 'i') {
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? raw : parsed;
  }
  if (kind === 'f') {
    const parsed = Number.parseFloat(raw);
    return Number.isNaN(parsed) ? raw : parsed;
  }
  if (kind === 'b') {
    return raw === 'true';
  }
  return raw;
}

function asString(value: unknown, fallback = ''): string {
  const decoded = decodeTagged(value);
  return typeof decoded === 'string' ? decoded : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const decoded = decodeTagged(value);
  return typeof decoded === 'number' && Number.isFinite(decoded) ? decoded : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  const decoded = decodeTagged(value);
  return typeof decoded === 'boolean' ? decoded : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Extracts the interesting parts of the payload of `/api/help`.
 *
 * The service publishes an `auth` block whose `required` field is a tagged
 * boolean: `b:false` means the service was started without the token
 * requirement, `b:true` means every route but the open ones needs the token.
 * When the block or the field is missing the policy is unknown (`null`).
 */
export function parseServiceInfo(payload: unknown): ServiceInfo {
  if (!isRecord(payload)) {
    return { version: null, authRequired: null, openRoutes: [] };
  }

  const rawVersion = payload['version'];
  const auth = payload['auth'];

  let authRequired: AuthRequirement = null;
  const openRoutes: string[] = [];

  if (isRecord(auth)) {
    const required = decodeTagged(auth['required']);
    if (typeof required === 'boolean') {
      authRequired = required;
    }
    const routes = auth['open_routes'];
    if (Array.isArray(routes)) {
      for (const route of routes) {
        if (typeof route === 'string') {
          openRoutes.push(route);
        }
      }
    }
  }

  return {
    version: typeof rawVersion === 'string' ? rawVersion : null,
    authRequired,
    openRoutes,
  };
}

function extractErrorMessage(status: number, body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null) {
      const message = (parsed as Record<string, unknown>)['message'];
      const error = (parsed as Record<string, unknown>)['error'];
      if (typeof message === 'string' && message.length > 0) {
        return message;
      }
      if (typeof error === 'string' && error.length > 0) {
        return error;
      }
    }
  } catch {
    // The body is not JSON, fall back to the raw text.
  }
  const trimmed = body.trim();
  return trimmed.length > 0 ? trimmed : `Request failed with status ${status}`;
}

export class ApiClient {
  readonly baseUrl: string;
  private token: string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_API_BASE_URL).replace(/\/+$/u, '');
    this.token = options.token ?? null;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  setToken(token: string | null): void {
    this.token = token !== null && token.trim().length > 0 ? token.trim() : null;
  }

  getToken(): string | null {
    return this.token;
  }

  /** `true` when the service answers on its open route (no token required). */
  async ping(): Promise<boolean> {
    const status = await this.fetchServiceStatus();
    return status.available;
  }

  /**
   * Reads the open route `/api/help` and works out the authentication policy.
   *
   * The policy comes from the `auth` block of the help page. When the help page
   * does not publish it, a protected route is probed **without** any token:
   * `GET /api/sysinfo` first (read only, no parameter) and then
   * `POST /api/shell` with a harmless `echo`. A `401` answer means the service
   * demands a token, a successful answer means it does not.
   */
  async fetchServiceStatus(): Promise<ServiceStatus> {
    let payload: unknown;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/help`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (response.status === 401) {
        // Even the help page is protected: a token is mandatory.
        return { available: true, authRequired: true, version: null };
      }
      if (!response.ok) {
        return { available: false, authRequired: null, version: null };
      }
      payload = (await response.json()) as unknown;
    } catch {
      return { available: false, authRequired: null, version: null };
    }

    const info = parseServiceInfo(payload);
    const authRequired = info.authRequired ?? (await this.probeAuthRequirement());
    return { available: true, authRequired, version: info.version };
  }

  /**
   * Finds out whether the service demands a token by calling a protected route
   * without one. `null` means "it could not be determined".
   */
  private async probeAuthRequirement(): Promise<AuthRequirement> {
    const readOnly = await this.probeWithoutToken(`${this.baseUrl}/api/sysinfo`, {
      method: 'GET',
    });
    if (readOnly !== null) {
      return readOnly;
    }
    return this.probeWithoutToken(`${this.baseUrl}/api/shell`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'echo gnumarus-auth-probe' }),
    });
  }

  /**
   * Calls a route **without** the `Authorization` header.
   *
   * Returns `true` when the service answers `401` (a token is required),
   * `false` when it accepts the call (no token is required) and `null` when the
   * answer says nothing about the token (unknown route, network error, ...).
   */
  private async probeWithoutToken(url: string, init: RequestInit): Promise<AuthRequirement> {
    try {
      const headers = new Headers(init.headers);
      headers.delete('Authorization');
      headers.set('Accept', 'application/json');
      const response = await this.fetchImpl(url, { ...init, headers });
      if (response.status === 401) {
        return true;
      }
      return response.ok ? false : null;
    } catch {
      return null;
    }
  }

  async readDirectory(path: string): Promise<DirectoryEntry[]> {
    const payload = await this.requestJson(`/api/dir?path=${encodeURIComponent(path)}`, {
      method: 'GET',
    });
    const entries = (payload as { readonly entries?: unknown }).entries;
    if (!Array.isArray(entries)) {
      return [];
    }
    return entries.map((entry) => {
      const raw = entry as RawDirectoryEntry;
      const type = asString(raw.type, 'other');
      return {
        name: asString(raw.name),
        path: asString(raw.path),
        type: isDirectoryEntryType(type) ? type : 'other',
        size: asNumber(raw.size),
        mtime: asNumber(raw.mtime),
      };
    });
  }

  async readFile(path: string): Promise<FileContent> {
    const payload = await this.requestJson(`/api/file?path=${encodeURIComponent(path)}`, {
      method: 'GET',
    });
    const raw = payload as RawFileResponse;
    return {
      path: asString(raw.path, path),
      absolutePath: asString(raw.absolute_path, path),
      content: asString(raw.content),
      size: asNumber(raw.size),
      isBinary: asBoolean(raw.is_binary),
    };
  }

  /** Creates a file, failing when it already exists. */
  async createFile(path: string, content: string): Promise<void> {
    await this.requestJson(`/api/file?path=${encodeURIComponent(path)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, encoding: 'text' }),
    });
  }

  /** Overwrites an existing file. */
  async overwriteFile(path: string, content: string): Promise<void> {
    await this.requestJson(`/api/file?path=${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, encoding: 'text' }),
    });
  }

  /** Creates the file or overwrites it when it already exists. */
  async writeFileEnsuring(path: string, content: string): Promise<void> {
    try {
      await this.createFile(path, content);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await this.overwriteFile(path, content);
        return;
      }
      throw error;
    }
  }

  async deleteFile(path: string): Promise<void> {
    await this.requestJson(`/api/file?path=${encodeURIComponent(path)}`, {
      method: 'DELETE',
    });
  }

  async fileExists(path: string): Promise<boolean> {
    try {
      await this.readFile(path);
      return true;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
        return false;
      }
      throw error;
    }
  }

  async execShell(request: ShellRequest): Promise<ShellResult> {
    const body: Record<string, unknown> = {
      command: request.command,
    };
    if (request.cwd !== undefined) {
      body['cwd'] = request.cwd;
    }
    if (request.stdin !== undefined) {
      body['stdin'] = request.stdin;
      body['stdin_encoding'] = 'text';
    }
    if (request.timeout !== undefined) {
      body['timeout'] = encodeTaggedNumber(request.timeout);
    }

    const payload = await this.requestJson('/api/shell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const raw = payload as RawShellResponse;
    return {
      command: asString(raw.command, request.command),
      cwd: asString(raw.cwd, request.cwd ?? ''),
      returncode: asNumber(raw.returncode),
      stdout: asString(raw.stdout),
      stderr: asString(raw.stderr),
      timedOut: asBoolean(raw.timed_out),
      stdoutTruncated: asBoolean(raw.stdout_truncated),
      stderrTruncated: asBoolean(raw.stderr_truncated),
    };
  }

  /** Lists the mount points that behave like "drives" for the file dialog. */
  async listMountPoints(): Promise<string[]> {
    try {
      const file = await this.readFile('/proc/mounts');
      return parseMountPoints(file.content);
    } catch {
      return ['/'];
    }
  }

  /** Absolute path of the home directory of the user running the service. */
  async homeDirectory(): Promise<string> {
    const result = await this.execShell({ command: 'printf %s "$HOME"' });
    const home = result.stdout.trim();
    return home.length > 0 ? home : '~';
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (this.token !== null) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ApiUnavailableError(`The Gnumarus OS Bridge service is unreachable: ${message}`);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ApiError(extractErrorMessage(response.status, body), response.status);
    }

    const text = await response.text();
    if (text.trim().length === 0) {
      return {};
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ApiError('The service returned a malformed JSON payload', response.status);
    }
  }
}

function isDirectoryEntryType(value: string): value is DirectoryEntryType {
  return value === 'file' || value === 'dir' || value === 'symlink' || value === 'other';
}

/**
 * Encodes a number the way the service expects it in the request bodies:
 * integers as `i:<int>` and fractional numbers as `f:<float>`.
 */
export function encodeTaggedNumber(value: number): string {
  return Number.isInteger(value) ? `i:${value}` : `f:${value}`;
}

const PSEUDO_FILE_SYSTEMS = new Set([
  'autofs',
  'binfmt_misc',
  'bpf',
  'cgroup',
  'cgroup2',
  'configfs',
  'debugfs',
  'devpts',
  'devtmpfs',
  'efivarfs',
  'fuse.gvfsd-fuse',
  'fusectl',
  'hugetlbfs',
  'mqueue',
  'nsfs',
  'proc',
  'pstore',
  'rpc_pipefs',
  'securityfs',
  'selinuxfs',
  'sysfs',
  'tmpfs',
  'tracefs',
]);

/**
 * Extracts the "drive" like mount points out of the content of `/proc/mounts`.
 */
export function parseMountPoints(content: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const line of content.split('\n')) {
    const parts = line.trim().split(/\s+/u);
    if (parts.length < 3) {
      continue;
    }
    const mountPoint = (parts[1] ?? '').replace(/\\040/gu, ' ');
    const fsType = parts[2] ?? '';
    if (mountPoint.length === 0 || !mountPoint.startsWith('/')) {
      continue;
    }
    if (PSEUDO_FILE_SYSTEMS.has(fsType)) {
      continue;
    }
    if (seen.has(mountPoint)) {
      continue;
    }
    seen.add(mountPoint);
    result.push(mountPoint);
  }

  if (!seen.has('/')) {
    result.unshift('/');
  }
  return result.sort((left, right) => left.localeCompare(right));
}
