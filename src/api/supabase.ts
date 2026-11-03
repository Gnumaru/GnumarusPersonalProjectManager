/**
 * Minimal Supabase client over plain `fetch`.
 *
 * The application talks to a Supabase project through its PostgREST API, with
 * no extra dependency. Every record is one row of a normalized table:
 * `tasks`, `comments`, `notes`, a key/value `config` table and an `ids`
 * registry table. Authentication is the project URL plus its API key, sent as
 * the `apikey` header and the `Authorization` bearer on every request.
 */

import { ApiError } from './client.js';

/** The tables of the project, in setup order. */
export const SUPABASE_TABLES = ['tasks', 'comments', 'notes', 'config', 'ids'] as const;

/** One of the tables of the project. */
export type SupabaseTable = (typeof SUPABASE_TABLES)[number];

/** A cell of a row: the columns are text, numbers, booleans or null. */
export type SupabaseValue = string | number | boolean | null;

/** One row, keyed by column name. */
export type SupabaseRow = Record<string, SupabaseValue>;

/** One column of the setup script: its name and the rest of its definition. */
export interface SupabaseColumn {
  readonly name: string;
  /** Everything after the name, e.g. `text not null default ''`. */
  readonly definition: string;
}

/** The shape of one table: its id column and its other columns. */
export interface SupabaseTableDef {
  /** The primary key column, created together with the table. */
  readonly idColumn: string;
  /** The type of the primary key, e.g. `bigint`. */
  readonly idType: string;
  /** The remaining columns, added one by one. */
  readonly columns: readonly SupabaseColumn[];
}

/**
 * The schema of the project, the single source of truth for the setup
 * script, the verification and the fake of the tests.
 *
 * Dates are real `timestamp` columns (without time zone, like the local
 * times of the compact format), nullable for unknown dates. Every
 * identifier is double-quoted: `end` is a reserved word.
 */
export const SUPABASE_SCHEMA: Readonly<Record<SupabaseTable, SupabaseTableDef>> = {
  tasks: {
    idColumn: 'id',
    idType: 'bigint',
    columns: [
      { name: 'title', definition: "text not null default ''" },
      { name: 'status', definition: "text not null default 'todo'" },
      { name: 'parent', definition: 'bigint' },
      { name: 'tags', definition: "text not null default ''" },
      { name: 'created', definition: 'timestamp' },
      { name: 'updated', definition: 'timestamp' },
      { name: 'start', definition: 'timestamp' },
      { name: 'end', definition: 'timestamp' },
      { name: 'blocked_by', definition: "text not null default ''" },
      { name: 'related', definition: "text not null default ''" },
      { name: 'expanded', definition: 'boolean not null default false' },
      { name: 'type', definition: "text not null default 'Feature'" },
      { name: 'role', definition: "text not null default 'Programming'" },
      { name: 'kanban_hidden', definition: 'boolean not null default false' },
      { name: 'tree_gantt_hidden', definition: 'boolean not null default false' },
      { name: 'kanban_order', definition: 'integer not null default 0' },
      { name: 'tree_gantt_order', definition: 'integer not null default 0' },
      { name: 'description', definition: "text not null default ''" },
    ],
  },
  comments: {
    idColumn: 'id',
    idType: 'bigint',
    columns: [
      { name: 'task', definition: 'bigint not null' },
      { name: 'created', definition: 'timestamp' },
      { name: 'updated', definition: 'timestamp' },
      { name: 'body', definition: "text not null default ''" },
    ],
  },
  notes: {
    idColumn: 'id',
    idType: 'bigint',
    columns: [
      { name: 'title', definition: "text not null default ''" },
      { name: 'created', definition: 'timestamp' },
      { name: 'updated', definition: 'timestamp' },
      { name: 'body', definition: "text not null default ''" },
    ],
  },
  config: {
    idColumn: 'key',
    idType: 'text',
    columns: [{ name: 'value', definition: "text not null default ''" }],
  },
  ids: {
    idColumn: 'id',
    idType: 'bigint',
    columns: [],
  },
};

/** Every column of a table, id column first. */
export function supabaseColumns(table: SupabaseTable): readonly string[] {
  const def = SUPABASE_SCHEMA[table];
  return [def.idColumn, ...def.columns.map((column) => column.name)];
}

/**
 * The queries a fresh Supabase project needs, shown when the database is
 * not as expected.
 *
 * Idempotent DDL only: every table is created with just its id column and
 * all other columns follow one by one with `if not exists`, so the block is
 * safe on a new database and on one that already holds some tables. Nothing
 * else is included: no grants and no policies, on the assumption of a new
 * database without row level security.
 */
export const SUPABASE_SETUP_SQL: string = (() => {
  const blocks: string[] = [
    '-- Gnumarus Project Manager: Supabase setup.',
    '-- Run this whole block once in the SQL editor of the Supabase project.',
  ];
  for (const table of SUPABASE_TABLES) {
    const def = SUPABASE_SCHEMA[table];
    blocks.push(
      `create table if not exists public."${table}" ("${def.idColumn}" ${def.idType} primary key);`,
    );
    for (const column of def.columns) {
      blocks.push(
        `alter table public."${table}" add column if not exists "${column.name}" ${column.definition};`,
      );
    }
  }
  return `${blocks.join('\n')}\n`;
})();

/** Where the Supabase URL is kept: ephemeral, like the bridge token. */
export const SUPABASE_URL_KEY = 'gnumarus-project-manager.supabase-url';

/** Where the Supabase API key is kept: ephemeral, like the bridge token. */
export const SUPABASE_KEY_KEY = 'gnumarus-project-manager.supabase-key';

export interface SupabaseCredentials {
  readonly url: string;
  readonly key: string;
}

export interface SupabaseClientOptions extends SupabaseCredentials {
  /** Overridable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch | undefined;
}

/** Why the Supabase database cannot be used as is. */
export type SupabaseSchemaIssue =
  /** The URL or the key is rejected: the user types new credentials. */
  | { readonly kind: 'invalid-credentials'; readonly detail: string }
  /** The project cannot be reached at all. */
  | { readonly kind: 'unreachable'; readonly detail: string }
  /** A table does not exist: the setup queries create it. */
  | { readonly kind: 'missing-table'; readonly detail: string }
  /** A table exists but misses columns: the setup queries add them. */
  | { readonly kind: 'wrong-format'; readonly detail: string }
  /** Reads work but a request is denied: the setup queries are shown. */
  | { readonly kind: 'access-denied'; readonly detail: string };

export type SupabaseSchemaCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly issue: SupabaseSchemaIssue };

/** One step of the verification, reported while the database is tested. */
export type SupabaseVerificationStep =
  /** A table is being probed with all of its columns. */
  | {
      readonly kind: 'table';
      readonly table: SupabaseTable;
      readonly index: number;
      readonly total: number;
    }
  /** The write-read-delete round trip is being made. */
  | { readonly kind: 'write' }
  /** Every check passed and the database can be used. */
  | { readonly kind: 'done' };

export interface SupabaseVerificationOptions {
  /** Called before every step, so the caller can show the progress. */
  readonly onStep?: ((step: SupabaseVerificationStep) => void) | undefined;
}

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

/** True when the answer rejects the credentials themselves. */
function isInvalidCredentials(status: number, body: unknown): boolean {
  if (status !== 401 && status !== 403) {
    return false;
  }
  if (isRecord(body)) {
    const message = body['message'];
    if (typeof message === 'string' && /invalid( api)? key/iu.test(message)) {
      return true;
    }
  }
  return false;
}

export interface SupabaseSelect {
  /** The columns to read. */
  readonly select: readonly string[];
  /** An equality filter, e.g. `{ column: 'id', value: 12 }`. */
  readonly filter?: { readonly column: string; readonly value: string | number } | undefined;
  /** The column the rows are ordered by. */
  readonly order?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
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

  /** Reads rows of a table, in stable pages. */
  async selectRows(table: SupabaseTable, select: SupabaseSelect): Promise<SupabaseRow[]> {
    const rows: SupabaseRow[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const params = new URLSearchParams({
        select: select.select.join(','),
        limit: String(select.limit ?? pageSize),
        offset: String(select.offset ?? offset),
      });
      if (select.filter !== undefined) {
        params.set(select.filter.column, `eq.${select.filter.value}`);
      }
      if (select.order !== undefined) {
        params.set('order', select.order);
      }
      const body = await this.request(`/rest/v1/${table}?${params.toString()}`, {
        method: 'GET',
      });
      if (!Array.isArray(body) || body.length === 0) {
        break;
      }
      for (const row of body) {
        if (isRecord(row)) {
          const projected: SupabaseRow = {};
          for (const [column, value] of Object.entries(row)) {
            if (
              typeof value === 'string' ||
              typeof value === 'number' ||
              typeof value === 'boolean' ||
              value === null
            ) {
              projected[column] = value;
            }
          }
          rows.push(projected);
        }
      }
      if (body.length < (select.limit ?? pageSize)) {
        break;
      }
    }
    return rows;
  }

  /**
   * Reads the rows of a table without any row: proves the table and the
   * columns exist.
   */
  async probeTable(table: SupabaseTable, columns: readonly string[]): Promise<void> {
    await this.selectRows(table, { select: columns, limit: 1 });
  }

  /** Inserts rows, failing with 409 on a duplicated primary key. */
  async insertRows(table: SupabaseTable, rows: readonly SupabaseRow[]): Promise<void> {
    await this.request(`/rest/v1/${table}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(rows),
    });
  }

  /** Inserts the rows or replaces the ones with the same primary key. */
  async upsertRows(table: SupabaseTable, rows: readonly SupabaseRow[]): Promise<void> {
    await this.request(`/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal,resolution=merge-duplicates',
      },
      body: JSON.stringify(rows),
    });
  }

  /** Deletes the rows matching an equality filter. */
  async deleteRows(
    table: SupabaseTable,
    filter: { readonly column: string; readonly value: string | number },
  ): Promise<void> {
    const params = new URLSearchParams({ [filter.column]: `eq.${filter.value}` });
    await this.request(`/rest/v1/${table}?${params.toString()}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
  }
}

/**
 * Connects and tests whether the database is as expected.
 *
 * Probes every table with all of its columns (a missing table or a missing
 * column shows the setup queries) and finishes with a write-read-delete
 * round trip on the tasks table, so denied writes surface here and not in
 * the middle of the work.
 */
export async function verifySupabaseSchema(
  client: SupabaseClient,
  options: SupabaseVerificationOptions = {},
): Promise<SupabaseSchemaCheck> {
  const report = options.onStep ?? ((): void => undefined);
  for (const [index, table] of SUPABASE_TABLES.entries()) {
    report({ kind: 'table', table, index: index + 1, total: SUPABASE_TABLES.length });
    try {
      await client.probeTable(table, supabaseColumns(table));
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      if (isInvalidCredentials(error.status, error.body)) {
        return { ok: false, issue: { kind: 'invalid-credentials', detail: error.message } };
      }
      if (error.status === 0 || error.status >= 500) {
        return { ok: false, issue: { kind: 'unreachable', detail: error.message } };
      }
      if (isMissingTable(error.status, error.body)) {
        return { ok: false, issue: { kind: 'missing-table', detail: error.message } };
      }
      if (error.status === 400) {
        return { ok: false, issue: { kind: 'wrong-format', detail: error.message } };
      }
      return { ok: false, issue: { kind: 'access-denied', detail: error.message } };
    }
  }

  try {
    report({ kind: 'write' });
    const probe = randomProbeId();
    await client.insertRows('tasks', [{ id: probe, title: '__gnumarus_probe__' }]);
    const back = await client.selectRows('tasks', {
      select: ['id', 'title'],
      filter: { column: 'id', value: probe },
    });
    if (back.length !== 1 || back[0]?.['title'] !== '__gnumarus_probe__') {
      return {
        ok: false,
        issue: { kind: 'access-denied', detail: 'The probe row could not be read back.' },
      };
    }
    await client.deleteRows('tasks', { column: 'id', value: probe });
  } catch (error) {
    if (error instanceof ApiError && error.status === 0) {
      return { ok: false, issue: { kind: 'unreachable', detail: error.message } };
    }
    return {
      ok: false,
      issue: {
        kind: 'access-denied',
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
  report({ kind: 'done' });
  return { ok: true };
}

/** A probe id that cannot collide with a real record in practice. */
function randomProbeId(): number {
  const buffer = new Uint32Array(2);
  try {
    globalThis.crypto?.getRandomValues(buffer);
  } catch {
    buffer[0] = Math.floor(Math.random() * 4294967296);
    buffer[1] = Math.floor(Math.random() * 4294967296);
  }
  const raw = (BigInt((buffer[0] ?? 0) >>> 10) << 32n) | BigInt(buffer[1] ?? 0);
  const id = raw % BigInt(Number.MAX_SAFE_INTEGER);
  return id === 0n ? 1 : Number(id);
}
