import { describe, expect, it } from 'vite-plus/test';
import {
  SUPABASE_SETUP_SQL,
  SUPABASE_TABLES,
  SupabaseClient,
  normalizeSupabaseUrl,
  supabaseColumns,
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

type Route = {
  match: (url: string, method: string) => boolean;
  respond: (url: string) => Response;
};

/** A fetch mock answering from a route table, recording every request. */
function mockFetch(routes: readonly Route[], seen: SeenRequest[] = []): typeof fetch {
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

function tableUrl(table: string): string {
  return `${SUPABASE_URL}/rest/v1/${table}`;
}

/** Routes of a healthy project: probes plus a write round trip on tasks. */
function healthyRoutes(stored: Map<string, Record<string, unknown>>): {
  routes: Route[];
  seen: SeenRequest[];
} {
  const seen: SeenRequest[] = [];
  const routes: Route[] = [
    {
      match: (url, method) => method === 'GET' && url.includes('/rest/v1/tasks?'),
      respond: (url: string) => {
        const parsed = new URL(url);
        const filter = parsed.searchParams.get('id') ?? '';
        if (filter.startsWith('eq.')) {
          const wanted = filter.slice('eq.'.length);
          const row = stored.get(wanted);
          return jsonResponse(row === undefined ? [] : [row]);
        }
        return jsonResponse([]);
      },
    },
    {
      match: (url, method) =>
        method === 'GET' &&
        ['comments', 'notes', 'config', 'ids'].some((table) => url.startsWith(`${tableUrl(table)}?`)),
      respond: () => jsonResponse([]),
    },
    {
      match: (url, method) => method === 'POST' && url === tableUrl('tasks'),
      respond: () => {
        const last = seen[seen.length - 1];
        const body = JSON.parse((last?.body ?? '[]') as string) as Record<string, unknown>[];
        for (const row of body) {
          stored.set(String(row['id']), row);
        }
        return jsonResponse([], 201);
      },
    },
    {
      match: (url, method) => method === 'DELETE' && url.startsWith(`${tableUrl('tasks')}?`),
      respond: (url: string) => {
        const filter = new URL(url).searchParams.get('id') ?? '';
        if (filter.startsWith('eq.')) {
          stored.delete(filter.slice('eq.'.length));
        }
        return new Response(null, { status: 204 });
      },
    },
  ];
  return { routes, seen };
}

function clientWith(routes: readonly Route[], seen: SeenRequest[]): SupabaseClient {
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

describe('supabaseColumns', () => {
  it('lists the id column first for every table', () => {
    expect(supabaseColumns('tasks')[0]).toBe('id');
    expect(supabaseColumns('tasks')).toContain('description');
    expect(supabaseColumns('comments')).toEqual(['id', 'task', 'created', 'updated', 'body']);
    expect(supabaseColumns('notes')).toEqual(['id', 'title', 'created', 'updated', 'body']);
    expect(supabaseColumns('config')).toEqual(['key', 'value']);
    expect(supabaseColumns('ids')).toEqual(['id']);
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
      await client.probeTable('tasks', supabaseColumns('tasks'));
      expect(seen).toHaveLength(1);
    } finally {
      globalThis.fetch = previous;
    }
  });

  it('sends the key as apikey and bearer on every request', async () => {
    const { routes, seen } = healthyRoutes(new Map());
    const client = clientWith(routes, seen);
    await client.probeTable('tasks', supabaseColumns('tasks'));

    expect(seen.length).toBeGreaterThan(0);
    for (const request of seen) {
      expect(request.headers.get('apikey')).toBe(KEY);
      expect(request.headers.get('Authorization')).toBe(`Bearer ${KEY}`);
    }
    expect(seen[0]?.url.startsWith(`${SUPABASE_URL}/rest/v1/tasks?`)).toBe(true);
  });

  it('upserts with merge-duplicates and fails inserts with 409', async () => {
    const seen: SeenRequest[] = [];
    const client = clientWith(
      [
        {
          match: (url, method) => method === 'POST' && url === tableUrl('tasks'),
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
    await client.upsertRows('tasks', [{ id: 1, title: 'x' }]);
    expect(seen[0]?.headers.get('Prefer')).toContain('resolution=merge-duplicates');
    await expect(client.insertRows('tasks', [{ id: 1, title: 'x' }])).rejects.toMatchObject({
      status: 409,
    });
  });

  it('reads a missing row as null and pages the listing', async () => {
    const seen: SeenRequest[] = [];
    const rows = Array.from({ length: 1001 }, (_, index) => ({ id: index + 1 }));
    const client = clientWith(
      [
        {
          match: (url, method) => method === 'GET' && url.startsWith(`${tableUrl('tasks')}?`),
          respond: (url: string) => {
            const parsed = new URL(url);
            const filter = parsed.searchParams.get('id') ?? '';
            if (filter.startsWith('eq.')) {
              return jsonResponse([]);
            }
            const offset = Number.parseInt(parsed.searchParams.get('offset') ?? '0', 10);
            return jsonResponse(rows.slice(offset, offset + 1000));
          },
        },
      ],
      seen,
    );
    expect(await client.selectRows('tasks', { select: ['id'], filter: { column: 'id', value: 9 } })).toEqual([]);
    expect((await client.selectRows('tasks', { select: ['id'] })).length).toBe(1001);
  });
});

describe('verifySupabaseSchema', () => {
  it('accepts a healthy project and cleans the probe row', async () => {
    const { routes, seen } = healthyRoutes(new Map());
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

  it('reports a missing table', async () => {
    const seen: SeenRequest[] = [];
    const client = clientWith(
      [
        {
          match: () => true,
          respond: () =>
            jsonResponse(
              { code: 'PGRST205', message: "Could not find the table 'public.tasks' in the schema cache" },
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

  it('reports a wrong format when a column is missing', async () => {
    const seen: SeenRequest[] = [];
    const client = clientWith(
      [
        {
          match: (url, method) => method === 'GET' && url.includes('/rest/v1/'),
          respond: () => jsonResponse({ message: 'column description does not exist' }, 400),
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

  it('reports denied access with the setup queries', async () => {
    const seen: SeenRequest[] = [];
    const client = clientWith(
      [
        {
          match: (url, method) => method === 'GET' && url.includes('/rest/v1/'),
          respond: () => jsonResponse([]),
        },
        {
          match: (url, method) => method === 'POST' && url === tableUrl('tasks'),
          respond: () => jsonResponse({ message: 'permission denied for table tasks' }, 401),
        },
        {
          match: (url, method) => method === 'DELETE' && url.startsWith(`${tableUrl('tasks')}?`),
          respond: () => new Response(null, { status: 204 }),
        },
      ],
      seen,
    );
    const check = await verifySupabaseSchema(client);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.issue.kind).toBe('access-denied');
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
  it('creates every table with its id column and adds the rest one by one', () => {
    for (const table of SUPABASE_TABLES) {
      expect(SUPABASE_SETUP_SQL).toContain(`create table if not exists public.${table}`);
    }
    expect(SUPABASE_SETUP_SQL).toContain('add column if not exists description');
    expect(SUPABASE_SETUP_SQL).toContain('add column if not exists body');
    expect(SUPABASE_SETUP_SQL).toContain('add column if not exists value');
    expect(SUPABASE_SETUP_SQL).not.toContain('grant');
    expect(SUPABASE_SETUP_SQL).not.toContain('policy');
    expect(SUPABASE_SETUP_SQL).not.toContain('row level security');
  });
});
