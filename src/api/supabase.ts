/**
 * Minimal Supabase client over plain `fetch`.
 *
 * The application talks to a Supabase project through its PostgREST API, with
 * no extra dependency: every file of the project is one row of a single
 * table. Authentication is the project URL plus its API key, sent as the
 * `apikey` header and the `Authorization` bearer on every request.
 */

import { ApiError } from './client.js';

/** The table that holds every file of the project. */
export const SUPABASE_TABLE = 'gnumarus_files';

/** The PostgREST path of the table. */
export const SUPABASE_TABLE_PATH = '/rest/v1/gnumarus_files';

/** Where the Supabase URL is kept: ephemeral, like the bridge token. */
export const SUPABASE_URL_KEY = 'gnumarus-project-manager.supabase-url';

/** Where the Supabase API key is kept: ephemeral, like the bridge token. */
export const SUPABASE_KEY_KEY = 'gnumarus-project-manager.supabase-key';

/**
 * The queries a fresh Supabase project needs, shown when the database is
 * not as expected.
 *
 * Besides the table itself they grant the table to the keys the application
 * uses and open permissive row level security policies: without them a
 * default Supabase project rejects every request, even with a valid key.
 * Anyone holding the project URL and key can read and write this table.
 */
export const SUPABASE_SETUP_SQL = `-- Gnumarus Project Manager: Supabase setup.
-- Run this whole block once in the SQL editor of the Supabase project.
create table if not exists public.gnumarus_files (
  path text primary key,
  content text not null default ''
);

-- The application talks to the database with the anon key (the service_role
-- key bypasses these, but the application works with either key).
grant all on table public.gnumarus_files to anon, authenticated;

alter table public.gnumarus_files enable row level security;

drop policy if exists "gnumarus_files_all" on public.gnumarus_files;
create policy "gnumarus_files_all"
  on public.gnumarus_files
  for all
  to anon, authenticated
  using (true)
  with check (true);
`;

export interface SupabaseCredentials {
  readonly url: string;
  readonly key: string;
}

export interface SupabaseClientOptions extends SupabaseCredentials {
  /** Overridable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch | undefined;
}

export interface SupabaseFileRow {
  readonly path: string;
  readonly content: string;
}

/** Why the Supabase database cannot be used as is. */
export type SupabaseSchemaIssue =
  /** The URL or the key is rejected: the user types new credentials. */
  | { readonly kind: 'invalid-credentials'; readonly detail: string }
  /** The project cannot be reached at all. */
  | { readonly kind: 'unreachable'; readonly detail: string }
  /** The schema or the table does not exist. */
  | { readonly kind: 'missing-table'; readonly detail: string }
  /** The table exists but its columns do not match. */
  | { readonly kind: 'wrong-format'; readonly detail: string }
  /** Reads work but writes are denied (usually missing RLS policies). */
  | { readonly kind: 'write-denied'; readonly detail: string };

export type SupabaseSchemaCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly issue: SupabaseSchemaIssue };

/** The probe row written and removed while testing the database. */
const PROBE_PATH = '__gnumarus_probe__';

/**
 * Normalizes a Supabase project URL: trims it and drops trailing slashes.
 *
 * Throws when it is not an `http(s)` URL.
 */
export function normalizeSupabaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/u, '');
  if (!/^https?:\/\/[^/]+$/u.test(trimmed)) {
    throw new Error('The Supabase URL must look like https://xyz.supabase.co.');
  }
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorMessage(status: number, body: unknown): string {
  if (isRecord(body)) {
    const message = body['message'];
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
    const details = body['details'];
    if (typeof details === 'string' && details.length > 0) {
      return details;
    }
  }
  return `Supabase answered with status ${status}.`;
}

/** True when the answer complains about a missing table or schema. */
function isMissingTable(status: number, body: unknown): boolean {
  if (status !== 404) {
    return false;
  }
  if (isRecord(body)) {
    const code = body['code'];
    if (code === 'PGRST205') {
      return true;
    }
    const message = body['message'];
    if (typeof message === 'string' && /could not find|does not exist/iu.test(message)) {
      return true;
    }
  }
  return true;
}

export class SupabaseClient {
  private readonly baseUrl: string;
  private readonly key: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SupabaseClientOptions) {
    this.baseUrl = normalizeSupabaseUrl(options.url);
    this.key = options.key;
    // A bare `fetch` reference fails as "Illegal invocation" when called
    // unbound, so the global one is bound like the bridge client does.
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /** The normalized project URL, for the messages. */
  url(): string {
    return this.baseUrl;
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set('apikey', this.key);
    headers.set('Authorization', `Bearer ${this.key}`);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      throw new ApiError(
        `Unable to reach the Supabase project at ${this.baseUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        0,
      );
    }
    let body: unknown = null;
    const text = await response.text();
    if (text.length > 0) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text;
      }
    }
    if (!response.ok) {
      throw new ApiError(errorMessage(response.status, body), response.status, body);
    }
    return body;
  }

  /**
   * Reads the table definition without any row: proves the table and both
   * columns exist.
   */
  async probeTable(): Promise<void> {
    const params = new URLSearchParams({ select: 'path,content', limit: '1' });
    await this.request(`${SUPABASE_TABLE_PATH}?${params.toString()}`, { method: 'GET' });
  }

  /** The OpenAPI document of the project, `null` when it cannot be read. */
  async readOpenApi(): Promise<unknown | null> {
    try {
      return await this.request('/rest/v1/', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
    } catch {
      return null;
    }
  }

  /** The paths of every row, oldest first, in stable pages. */
  async listPaths(): Promise<string[]> {
    const paths: string[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const params = new URLSearchParams({
        select: 'path',
        order: 'path',
        limit: String(pageSize),
        offset: String(offset),
      });
      const body = await this.request(`${SUPABASE_TABLE_PATH}?${params.toString()}`, {
        method: 'GET',
      });
      if (!Array.isArray(body) || body.length === 0) {
        break;
      }
      for (const row of body) {
        if (isRecord(row) && typeof row['path'] === 'string') {
          paths.push(row['path']);
        }
      }
      if (body.length < pageSize) {
        break;
      }
    }
    return paths;
  }

  /** Every row of the table, in stable pages. */
  async listRows(): Promise<SupabaseFileRow[]> {
    const rows: SupabaseFileRow[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const params = new URLSearchParams({
        select: 'path,content',
        order: 'path',
        limit: String(pageSize),
        offset: String(offset),
      });
      const body = await this.request(`${SUPABASE_TABLE_PATH}?${params.toString()}`, {
        method: 'GET',
      });
      if (!Array.isArray(body) || body.length === 0) {
        break;
      }
      for (const row of body) {
        if (isRecord(row) && typeof row['path'] === 'string' && typeof row['content'] === 'string') {
          rows.push({ path: row['path'], content: row['content'] });
        }
      }
      if (body.length < pageSize) {
        break;
      }
    }
    return rows;
  }

  /** One row by path, `null` when it does not exist. */
  async readRow(path: string): Promise<SupabaseFileRow | null> {
    const params = new URLSearchParams({ select: 'path,content', path: `eq.${path}` });
    const body = await this.request(`${SUPABASE_TABLE_PATH}?${params.toString()}`, {
      method: 'GET',
    });
    if (!Array.isArray(body) || body.length === 0) {
      return null;
    }
    const row: unknown = body[0];
    if (isRecord(row) && typeof row['path'] === 'string' && typeof row['content'] === 'string') {
      return { path: row['path'], content: row['content'] };
    }
    return null;
  }

  /** Inserts a row, failing with 409 when the path already exists. */
  async insertRow(row: SupabaseFileRow): Promise<void> {
    await this.request(SUPABASE_TABLE_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify([row]),
    });
  }

  /** Inserts the row or replaces the one with the same path. */
  async upsertRow(row: SupabaseFileRow): Promise<void> {
    await this.request(SUPABASE_TABLE_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal,resolution=merge-duplicates',
      },
      body: JSON.stringify([row]),
    });
  }

  /** Deletes the row with the path; missing rows are not an error. */
  async deleteRow(path: string): Promise<void> {
    const params = new URLSearchParams({ path: `eq.${path}` });
    await this.request(`${SUPABASE_TABLE_PATH}?${params.toString()}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
  }
}

/** The table definition inside an OpenAPI document, either spec version. */
function findTableDefinition(openApi: unknown): Record<string, unknown> | null {
  if (!isRecord(openApi)) {
    return null;
  }
  const containers: unknown[] = [openApi['definitions']];
  const components = openApi['components'];
  if (isRecord(components)) {
    containers.push(components['schemas']);
  }
  for (const container of containers) {
    if (isRecord(container) && isRecord(container[SUPABASE_TABLE])) {
      return container[SUPABASE_TABLE];
    }
  }
  return null;
}

/** True when the definition matches `path`/`content` text columns. */
function definitionMatches(definition: Record<string, unknown>): boolean {
  const properties = definition['properties'];
  if (!isRecord(properties)) {
    return false;
  }
  for (const column of ['path', 'content']) {
    const property = properties[column];
    if (!isRecord(property) || property['type'] !== 'string') {
      return false;
    }
  }
  const required = definition['required'];
  if (!Array.isArray(required)) {
    return false;
  }
  return required.includes('path') && required.includes('content');
}

/**
 * Connects and tests whether the database is as expected.
 *
 * Reads the table definition (the probe plus the OpenAPI document, the
 * REST equivalent of asking for the DDL of every table) and finishes with
 * a write-read-delete round trip, so permission problems surface here and
 * not in the middle of the work.
 */
export async function verifySupabaseSchema(client: SupabaseClient): Promise<SupabaseSchemaCheck> {
  try {
    await client.probeTable();
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    if (error.status === 401 || error.status === 403) {
      return { ok: false, issue: { kind: 'invalid-credentials', detail: error.message } };
    }
    if (error.status === 0) {
      return { ok: false, issue: { kind: 'unreachable', detail: error.message } };
    }
    if (isMissingTable(error.status, error.body)) {
      return { ok: false, issue: { kind: 'missing-table', detail: error.message } };
    }
    if (error.status >= 500) {
      return { ok: false, issue: { kind: 'unreachable', detail: error.message } };
    }
    return { ok: false, issue: { kind: 'wrong-format', detail: error.message } };
  }

  const openApi = await client.readOpenApi();
  if (openApi !== null) {
    const definition = findTableDefinition(openApi);
    if (definition === null || !definitionMatches(definition)) {
      return {
        ok: false,
        issue: {
          kind: 'wrong-format',
          detail: `The table ${SUPABASE_TABLE} does not expose text path and content columns.`,
        },
      };
    }
  }

  try {
    await client.deleteRow(PROBE_PATH);
    await client.insertRow({ path: PROBE_PATH, content: 'probe' });
    const probe = await client.readRow(PROBE_PATH);
    if (probe?.content !== 'probe') {
      return {
        ok: false,
        issue: { kind: 'write-denied', detail: 'The probe row could not be read back.' },
      };
    }
    await client.deleteRow(PROBE_PATH);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      return {
        ok: false,
        issue: {
          kind: 'write-denied',
          detail: `${error.message} The key can read but not write: check the row level security policies.`,
        },
      };
    }
    if (error instanceof ApiError && error.status === 0) {
      return { ok: false, issue: { kind: 'unreachable', detail: error.message } };
    }
    return {
      ok: false,
      issue: {
        kind: 'write-denied',
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
  return { ok: true };
}
