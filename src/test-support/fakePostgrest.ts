/**
 * In memory fake of the PostgREST API of a Supabase project.
 *
 * It implements the normalized tables used by the application (`tasks`,
 * `comments`, `notes`, `config`, `ids`) with listing (`select`/`order`/
 * `limit`/`offset`), `eq` filters, inserts with 409 on duplicated primary
 * keys, upserts and deletes, using the same error shapes as the real
 * service, so the Supabase store is tested without any network.
 */

import { SUPABASE_SCHEMA, supabaseColumns, type SupabaseTable } from '../api/supabase.js';

export interface FakePostgrestOptions {
  /** Key accepted by the fake. `null` means only keyless requests pass. */
  readonly key?: string | null;
  /** Tables answering 404 like a missing table or schema. */
  readonly missingTables?: readonly SupabaseTable[];
  /** Columns missing from tables, like a wrong table format. */
  readonly dropColumns?: Partial<Readonly<Record<SupabaseTable, readonly string[]>>>;
  /** When `true`, writes answer 401 like denied row level security. */
  readonly denyWrites?: boolean;
}

export class FakePostgrest {
  /** The rows of every table, keyed by primary key. */
  readonly tables: Record<SupabaseTable, Map<string, Record<string, unknown>>>;
  readonly requests: { method: string; path: string }[] = [];
  readonly key: string | null;
  readonly missingTables: ReadonlySet<SupabaseTable>;
  readonly dropColumns: Partial<Readonly<Record<SupabaseTable, readonly string[]>>>;
  readonly denyWrites: boolean;

  constructor(options: FakePostgrestOptions = {}) {
    this.key = options.key === undefined ? 'test-key' : options.key;
    this.missingTables = new Set(options.missingTables ?? []);
    this.dropColumns = options.dropColumns ?? {};
    this.denyWrites = options.denyWrites ?? false;
    this.tables = { tasks: new Map(), comments: new Map(), notes: new Map(), config: new Map(), ids: new Map() };
  }

  /** The columns a table exposes, minus the dropped ones. */
  private exposedColumns(table: SupabaseTable): string[] {
    const dropped = new Set(this.dropColumns[table] ?? []);
    return supabaseColumns(table).filter((column) => !dropped.has(column));
  }

  /** Adds a row to a table, bypassing validation like a hand-written seed. */
  addRow(table: SupabaseTable, row: Record<string, unknown>): void {
    const pk = SUPABASE_SCHEMA[table].idColumn;
    this.tables[table].set(String(row[pk]), { ...row });
  }

  /** The `fetch` implementation to hand over to the Supabase client. */
  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    this.requests.push({ method, path: url.pathname });

    if (!this.isAuthorized(init)) {
      return json({ message: 'Invalid API key', code: 'PGRST000' }, 401);
    }

    const match = /^\/rest\/v1\/([a-z_]+)$/u.exec(url.pathname);
    const table = match?.[1] as SupabaseTable | undefined;
    if (table === undefined || !(table in this.tables) || this.missingTables.has(table)) {
      return json(
        {
          code: 'PGRST205',
          message: `Could not find the table 'public.${url.pathname}' in the schema cache`,
        },
        404,
      );
    }

    if (method === 'GET') {
      return this.read(table, url);
    }
    if (method === 'POST') {
      return this.write(table, init);
    }
    if (method === 'DELETE') {
      return this.remove(table, url, init);
    }
    return json({ message: 'Unknown route', code: 'NONE' }, 404);
  };

  /**
   * Checks the `apikey` header of a request against the key of the fake, the
   * same way the real service rejects unknown keys.
   */
  private isAuthorized(init: RequestInit | undefined): boolean {
    const header = new Headers(init?.headers).get('apikey');
    return header === this.key;
  }

  private read(table: SupabaseTable, url: URL): Response {
    const columns = this.exposedColumns(table);
    const select = (url.searchParams.get('select') ?? columns.join(','))
      .split(',')
      .map((column) => column.trim())
      .filter((column) => column.length > 0);
    for (const column of select) {
      if (!columns.includes(column)) {
        return json({ message: `column "${column}" does not exist`, code: 'PGRST202' }, 400);
      }
    }
    let rows = [...this.tables[table].values()].map((row) => ({ ...row }));
    for (const [param, wanted] of url.searchParams) {
      if (param === 'select' || param === 'order' || param === 'limit' || param === 'offset') {
        continue;
      }
      if (!wanted.startsWith('eq.')) {
        return json({ message: 'Only eq filters are supported', code: 'NONE' }, 400);
      }
      if (!columns.includes(param)) {
        return json({ message: `column "${param}" does not exist`, code: 'PGRST202' }, 400);
      }
      const value = wanted.slice('eq.'.length);
      rows = rows.filter((row) => String(row[param]) === value);
    }
    const order = url.searchParams.get('order');
    if (order !== null) {
      rows.sort((left, right) => compareCells(left[order], right[order]));
    }
    const offset = Number.parseInt(url.searchParams.get('offset') ?? '0', 10);
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '1000', 10);
    const page = rows.slice(
      Number.isSafeInteger(offset) ? offset : 0,
      (Number.isSafeInteger(offset) ? offset : 0) + (Number.isSafeInteger(limit) ? limit : 1000),
    );
    return json(
      page.map((row) => {
        const projected: Record<string, unknown> = {};
        for (const column of select) {
          projected[column] = row[column] ?? null;
        }
        return projected;
      }),
    );
  }

  private write(table: SupabaseTable, init: RequestInit | undefined): Response {
    if (this.denyWrites) {
      return json(
        { message: 'new row violates row-level security policy for table "gnumarus_files"' },
        401,
      );
    }
    let body: unknown = null;
    try {
      body = JSON.parse(String(init?.body ?? 'null'));
    } catch {
      return json({ message: 'Invalid body', code: 'NONE' }, 400);
    }
    if (!Array.isArray(body)) {
      return json({ message: 'Invalid body', code: 'NONE' }, 400);
    }
    const columns = this.exposedColumns(table);
    const pk = SUPABASE_SCHEMA[table].idColumn;
    const prefer = new Headers(init?.headers).get('Prefer') ?? '';
    const upsert = prefer.includes('resolution=merge-duplicates');
    for (const entry of body) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        return json({ message: 'Invalid row', code: 'NONE' }, 400);
      }
      const row = entry as Record<string, unknown>;
      for (const column of Object.keys(row)) {
        if (!columns.includes(column)) {
          return json({ message: `column "${column}" does not exist`, code: 'PGRST202' }, 400);
        }
      }
      const key = String(row[pk]);
      if (!upsert && this.tables[table].has(key)) {
        return json(
          {
            code: '23505',
            message: `duplicate key value violates unique constraint "${table}_pkey"`,
          },
          409,
        );
      }
      this.tables[table].set(key, { ...row });
    }
    return json([], 201);
  }

  private remove(table: SupabaseTable, url: URL, init: RequestInit | undefined): Response {
    if (this.denyWrites) {
      return json(
        { message: 'new row violates row-level security policy for table "gnumarus_files"' },
        401,
      );
    }
    void init;
    const filters = [...url.searchParams].filter(
      ([param]) => param !== 'select' && param !== 'order' && param !== 'limit' && param !== 'offset',
    );
    if (filters.length === 0) {
      return json({ message: 'Filters are required', code: 'NONE' }, 400);
    }
    for (const [param, wanted] of filters) {
      if (!wanted.startsWith('eq.')) {
        return json({ message: 'Only eq filters are supported', code: 'NONE' }, 400);
      }
      const value = wanted.slice('eq.'.length);
      for (const [key, row] of [...this.tables[table].entries()]) {
        if (String(row[param]) === value) {
          this.tables[table].delete(key);
        }
      }
    }
    return new Response(null, { status: 204 });
  }
}

/** Numbers compare numerically, everything else as text. */
function compareCells(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  return String(left).localeCompare(String(right));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
