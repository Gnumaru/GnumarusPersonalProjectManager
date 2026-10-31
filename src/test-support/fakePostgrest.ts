/**
 * In memory fake of the PostgREST API of a Supabase project.
 *
 * It implements the single `gnumarus_files` table used by the application
 * (listing with `select`/`order`/`limit`/`offset`, `eq` filters, inserts with
 * 409 on duplicated paths, upserts and deletes) with the same error shapes
 * as the real service, so the Supabase store is tested without any network.
 */

export interface FakePostgrestOptions {
  /** Key accepted by the fake. `null` means only keyless requests pass. */
  readonly key?: string | null;
  /** When `true`, the table answers 404 like a missing table or schema. */
  readonly missingTable?: boolean;
  /** When `true`, writes answer 401 like denied row level security. */
  readonly denyWrites?: boolean;
}

export class FakePostgrest {
  readonly rows = new Map<string, string>();
  readonly requests: { method: string; path: string }[] = [];
  readonly key: string | null;
  readonly missingTable: boolean;
  readonly denyWrites: boolean;

  constructor(options: FakePostgrestOptions = {}) {
    this.key = options.key === undefined ? 'test-key' : options.key;
    this.missingTable = options.missingTable ?? false;
    this.denyWrites = options.denyWrites ?? false;
  }

  /** Adds a row to the fake table. */
  addRow(path: string, content: string): void {
    this.rows.set(path, content);
  }

  /** The `fetch` implementation to hand over to the Supabase client. */
  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    this.requests.push({ method, path: url.pathname });

    if (url.pathname === '/rest/v1/' || url.pathname === '/rest/v1') {
      return json({
        openapi: '3.0.0',
        info: { title: 'fake', version: '0.0.0' },
        components: {
          schemas: {
            gnumarus_files: this.missingTable
              ? undefined
              : {
                  required: ['path', 'content'],
                  properties: {
                    path: { type: 'string', format: 'text' },
                    content: { type: 'string', format: 'text' },
                  },
                },
          },
        },
      });
    }

    if (!this.isAuthorized(init)) {
      return json({ message: 'Invalid API key', code: 'PGRST000' }, 401);
    }

    if (url.pathname !== '/rest/v1/gnumarus_files' || this.missingTable) {
      return json(
        {
          code: 'PGRST205',
          message: "Could not find the table 'public.gnumarus_files' in the schema cache",
        },
        404,
      );
    }

    if (method === 'GET') {
      return this.read(url);
    }
    if (method === 'POST') {
      return this.write(url, init);
    }
    if (method === 'DELETE') {
      return this.remove(url);
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

  private read(url: URL): Response {
    const select = (url.searchParams.get('select') ?? 'path,content')
      .split(',')
      .map((column) => column.trim())
      .filter((column) => column.length > 0);
    for (const column of select) {
      if (column !== 'path' && column !== 'content') {
        return json({ message: `column "${column}" does not exist`, code: 'PGRST202' }, 400);
      }
    }
    const filter = url.searchParams.get('path') ?? null;
    let rows = [...this.rows.entries()].map(([path, content]) => ({ path, content }));
    if (filter !== null) {
      if (!filter.startsWith('eq.')) {
        return json({ message: 'Only eq filters are supported', code: 'NONE' }, 400);
      }
      const wanted = filter.slice('eq.'.length);
      rows = rows.filter((row) => row.path === wanted);
    }
    rows.sort((left, right) => left.path.localeCompare(right.path));
    const offset = Number.parseInt(url.searchParams.get('offset') ?? '0', 10);
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '1000', 10);
    const page = rows.slice(
      Number.isSafeInteger(offset) ? offset : 0,
      (Number.isSafeInteger(offset) ? offset : 0) + (Number.isSafeInteger(limit) ? limit : 1000),
    );
    return json(
      page.map((row) => {
        const projected: Record<string, string> = {};
        for (const column of select) {
          projected[column] = column === 'path' ? row.path : row.content;
        }
        return projected;
      }),
    );
  }

  private write(url: URL, init: RequestInit | undefined): Response {
    void url;
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
    const prefer = new Headers(init?.headers).get('Prefer') ?? '';
    const upsert = prefer.includes('resolution=merge-duplicates');
    for (const entry of body) {
      if (typeof entry !== 'object' || entry === null) {
        return json({ message: 'Invalid row', code: 'NONE' }, 400);
      }
      const row = entry as { path?: unknown; content?: unknown };
      if (typeof row.path !== 'string' || typeof row.content !== 'string') {
        return json({ message: 'Invalid row', code: 'NONE' }, 400);
      }
      if (!upsert && this.rows.has(row.path)) {
        return json(
          {
            code: '23505',
            message: 'duplicate key value violates unique constraint "gnumarus_files_pkey"',
          },
          409,
        );
      }
      this.rows.set(row.path, row.content);
    }
    return json([], 201);
  }

  private remove(url: URL): Response {
    if (this.denyWrites) {
      return json(
        { message: 'new row violates row-level security policy for table "gnumarus_files"' },
        401,
      );
    }
    const filter = url.searchParams.get('path');
    if (filter === null || !filter.startsWith('eq.')) {
      return json({ message: 'Filters are required', code: 'NONE' }, 400);
    }
    this.rows.delete(filter.slice('eq.'.length));
    return new Response(null, { status: 204 });
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
