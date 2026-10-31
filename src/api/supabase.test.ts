import { describe, expect, it } from 'vite-plus/test';
import {
  SUPABASE_SETUP_SQL,
  SUPABASE_TABLE,
  SupabaseClient,
  normalizeSupabaseUrl,
  verifySupabaseSchema,
} from './supabase.js';

const SUPABASE_URL = 'https://xyz.supabase.co';
const KEY = 'test-key';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface SeenRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string;
}

/** A fetch mock answering from a route table, recording every request. */
function mockFetch(
  routes: ReadonlyArray<{ match: (url: string, method: string) => boolean; respond: (url: string) => Response }>,
  seen: SeenRequest[] = [],
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    let body = '';
    if (typeof init?.body === 'string') {
      body = init.body;
    }
    seen.push({ url, method, headers, body });
    for (const route of routes) {
      if (route.match(url, method)) {
        return route.respond(url);
      }
    }
    return jsonResponse({ message: 'no route', code: 'NONE' }, 500);
  }) as typeof fetch;
}

function tableUrl(): string {
  return `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`;
}

function openApiBody(columns: readonly string[] = ['path', 'content']): unknown {
  const properties: Record<string, unknown> = {};
  for (const column of columns) {
    properties[column] = { type: 'string', format: 'text' };
  }
  return { definitions: { [SUPABASE_TABLE]: { required: [...columns], properties } } };
}

/** Routes of a healthy project: probe, OpenAPI and a write round trip. */
function healthyRoutes(rows: { path: string; content: string }[] = []): {
  routes: { match: (url: string, method: string) => boolean; respond: (url: string) => Response }[];
  seen: SeenRequest[];
} {
  const seen: SeenRequest[] = [];
  const stored = new Map(rows.map((row) => [row.path, row.content]));
  const routes = [
    {
      match: (url: string) => url === `${SUPABASE_URL}/rest/v1/`,
      respond: () => jsonResponse(openApiBody()),
    },
    {
      match: (url: string, method: string) => method === 'GET' && url.startsWith(`${tableUrl()}?`),
      respond: (url: string) => {
        const parsed = new URL(url);
        const filter = parsed.searchParams.get('path') ?? '';
        if (filter.startsWith('eq.')) {
          const wanted = filter.slice('eq.'.length);
          const content = stored.get(wanted);
          return jsonResponse(content === undefined ? [] : [{ path: wanted, content }]);
        }
        return jsonResponse([]);
      },
    },
    {
      match: (url: string, method: string) => method === 'POST' && url === tableUrl(),
      respond: () => {
        const last = seen[seen.length - 1];
        const body = JSON.parse((last?.body ?? '[]') as string) as { path: string; content: string }[];
        for (const row of body) {
          stored.set(row.path, row.content);
        }
        return jsonResponse([], 201);
      },
    },
    {
      match: (url: string, method: string) => method === 'DELETE' && url.startsWith(`${tableUrl()}?`),
      respond: (url: string) => {
        const parsed = new URL(url);
        const filter = parsed.searchParams.get('path') ?? '';
        for (const path of [...stored.keys()]) {
          if (filter === `eq.${path}`) {
            stored.delete(path);
          }
        }
        return new Response(null, { status: 204 });
      },
    },
  ];
  return { routes, seen };
}

function clientWith(
  routes: { match: (url: string, method: string) => boolean; respond: (url: string) => Response }[],
  seen: SeenRequest[],
): SupabaseClient {
  return new SupabaseClient({ url: SUPABASE_URL, key: KEY, fetchImpl: mockFetch(routes, seen) });
}

// A DOM is not needed here: the client only uses fetch.

describe('normalizeSupabaseUrl', () => {
  it('trims the URL and drops trailing slashes', () => {
    expect(normalizeSupabaseUrl('  https://xyz.supabase.co/// ')).toBe('https://xyz.supabase.co');
  });

  it('rejects anything but an http(s) URL', () => {
    expect(() => normalizeSupabaseUrl('')).toThrow();
    expect(() => normalizeSupabaseUrl('xyz.supabase.co')).toThrow();
    expect(() => normalizeSupabaseUrl('ftp://xyz.supabase.co')).toThrow();
  });
});

describe('SupabaseClient', () => {
  it('calls the global fetch bound, avoiding Illegal invocation', async () => {
    const seen: string[] = [];
    // Like a browser: the global fetch only works bound to the global scope.
    function strictFetch(
      this: unknown,
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      void init;
      if (this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      seen.push(typeof input === 'string' ? input : String(input));
      return Promise.resolve(jsonResponse([]));
    }
    const previous = globalThis.fetch;
    globalThis.fetch = strictFetch as typeof fetch;
    try {
      const client = new SupabaseClient({ url: SUPABASE_URL, key: KEY });
      await client.probeTable();
      expect(seen).toHaveLength(1);
    } finally {
      globalThis.fetch = previous;
    }
  });

  it('sends the key as apikey and bearer on every request', async () => {
    const { routes, seen } = healthyRoutes();
    const client = clientWith(routes, seen);
    await client.probeTable();

    expect(seen.length).toBeGreaterThan(0);
    for (const request of seen) {
      expect(request.headers.get('apikey')).toBe(KEY);
      expect(request.headers.get('Authorization')).toBe(`Bearer ${KEY}`);
    }
    expect(seen[0]?.url.startsWith('https://xyz.supabase.co/rest/v1/')).toBe(true);
  });

  it('upserts with merge-duplicates and fails inserts with 409', async () => {
    const seen: SeenRequest[] = [];
    const client = clientWith(
      [
        {
          match: (url, method) => method === 'POST' && url === tableUrl(),
          respond: (url: string) => {
            void url;
            const last = seen[seen.length - 1];
            const prefer = last?.headers.get('Prefer') ?? '';
            if (prefer.includes('resolution=merge-duplicates')) {
              return jsonResponse([], 201);
            }
            return jsonResponse({ code: '23505', message: 'duplicate key' }, 409);
          },
        },
      ],
      seen,
    );
    await client.upsertRow({ path: 'task_1.txt', content: 'x' });
    expect(seen[0]?.headers.get('Prefer')).toContain('resolution=merge-duplicates');
    await expect(client.insertRow({ path: 'task_1.txt', content: 'x' })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('reads a missing row as null and pages the listing', async () => {
    const seen: SeenRequest[] = [];
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      path: `task_${index + 1}.txt`,
      content: 'x',
    }));
    const client = clientWith(
      [
        {
          match: (url, method) => method === 'GET' && url.startsWith(`${tableUrl()}?`),
          respond: (url: string) => {
            const parsed = new URL(url);
            const offset = Number.parseInt(parsed.searchParams.get('offset') ?? '0', 10);
            if (parsed.searchParams.get('path')?.startsWith('eq.') === true) {
              return jsonResponse([]);
            }
            return jsonResponse(rows.slice(offset, offset + 1000));
          },
        },
      ],
      seen,
    );
    expect(await client.readRow('task_9.txt')).toBeNull();
    expect((await client.listRows()).length).toBe(1001);
  });
});

describe('verifySupabaseSchema', () => {
  it('accepts a healthy project and cleans the probe row', async () => {
    const { routes, seen } = healthyRoutes();
    const client = clientWith(routes, seen);
    expect(await verifySupabaseSchema(client)).toEqual({ ok: true });
    const deletes = seen.filter((request) => request.method === 'DELETE');
    expect(deletes.length).toBeGreaterThan(0);
  });

  it('asks for new credentials when they are rejected', async () => {
    const seen: SeenRequest[] = [];
    const client = clientWith(
      [
        {
          match: () => true,
          respond: () => jsonResponse({ message: 'Invalid API key', code: 'PGRST000' }, 401),
        },
      ],
      seen,
    );
    const check = await verifySupabaseSchema(client);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.issue.kind).toBe('invalid-credentials');
    }
  });

  it('reports a missing table or schema', async () => {
    const seen: SeenRequest[] = [];
    const client = clientWith(
      [
        {
          match: () => true,
          respond: () =>
            jsonResponse(
              {
                code: 'PGRST205',
                message: `Could not find the table 'public.${SUPABASE_TABLE}' in the schema cache`,
              },
              404,
            ),
        },
      ],
      seen,
    );
    const check = await verifySupabaseSchema(client);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.issue.kind).toBe('missing-table');
    }
  });

  it('reports a wrong format when the columns do not match', async () => {
    const seen: SeenRequest[] = [];
    const client = clientWith(
      [
        {
          match: (url, method) => method === 'GET' && url.startsWith(`${tableUrl()}?`),
          respond: () => jsonResponse({ message: 'column content does not exist' }, 400),
        },
      ],
      seen,
    );
    const check = await verifySupabaseSchema(client);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.issue.kind).toBe('wrong-format');
    }
  });

  it('reports a wrong format when the definition misses a column', async () => {
    const seen: SeenRequest[] = [];
    const client = clientWith(
      [
        {
          match: (url) => url === `${SUPABASE_URL}/rest/v1/`,
          respond: () => jsonResponse(openApiBody(['path'])),
        },
        {
          match: (url, method) => method === 'GET' && url.startsWith(`${tableUrl()}?`),
          respond: () => jsonResponse([]),
        },
        {
          match: (url, method) => method === 'POST' && url === tableUrl(),
          respond: () => jsonResponse([], 201),
        },
        {
          match: (url, method) => method === 'DELETE' && url.startsWith(`${tableUrl()}?`),
          respond: () => new Response(null, { status: 204 }),
        },
      ],
      seen,
    );
    const check = await verifySupabaseSchema(client);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.issue.kind).toBe('wrong-format');
    }
  });

  it('reports denied writes with a policy hint', async () => {
    const seen: SeenRequest[] = [];
    const client = clientWith(
      [
        {
          match: (url) => url === `${SUPABASE_URL}/rest/v1/`,
          respond: () => jsonResponse(openApiBody()),
        },
        {
          match: (url, method) => method === 'GET' && url.startsWith(`${tableUrl()}?`),
          respond: () => jsonResponse([]),
        },
        {
          match: (url, method) => method === 'POST' && url === tableUrl(),
          respond: () => jsonResponse({ message: 'new row violates row-level security' }, 401),
        },
        {
          match: (url, method) => method === 'DELETE' && url.startsWith(`${tableUrl()}?`),
          respond: () => new Response(null, { status: 204 }),
        },
      ],
      seen,
    );
    const check = await verifySupabaseSchema(client);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.issue.kind).toBe('write-denied');
    }
  });

  it('reports an unreachable project', async () => {
    const client = new SupabaseClient({
      url: SUPABASE_URL,
      key: KEY,
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    const check = await verifySupabaseSchema(client);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.issue.kind).toBe('unreachable');
    }
  });
});

describe('SUPABASE_SETUP_SQL', () => {
  it('carries the table and the policies the application needs', () => {
    expect(SUPABASE_SETUP_SQL).toContain(`create table if not exists public.${SUPABASE_TABLE}`);
    expect(SUPABASE_SETUP_SQL).toContain('path text primary key');
    expect(SUPABASE_SETUP_SQL).toContain('content text not null');
    expect(SUPABASE_SETUP_SQL).toContain('enable row level security');
    expect(SUPABASE_SETUP_SQL).toContain('create policy');
  });
});
