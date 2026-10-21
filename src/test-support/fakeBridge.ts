/**
 * In memory fake of the Gnumarus OS Bridge service.
 *
 * It implements the endpoints used by the application (files, directories and
 * the two shell commands used to list and to search task files) with the same
 * tagged scalar convention as the real service.
 *
 * It also reproduces the authentication policy of the real service: the open
 * route `/api/help` publishes the `auth` block, and every other route answers
 * `401` when the service demands a token and the request does not carry it.
 */

interface FakeEntry {
  readonly type: 'file' | 'dir';
}

export interface FakeBridgeOptions {
  readonly baseUrl?: string;
  /** Token accepted by the fake. `null` means no token is accepted at all. */
  readonly token?: string | null;
  /** Whether the service demands a token (default: `true`). */
  readonly authRequired?: boolean;
  /** Routes that always answer `401`, whatever the token is. */
  readonly rejectPaths?: readonly string[];
}

export class FakeBridge {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>(['/']);
  readonly requests: { method: string; path: string }[] = [];
  readonly baseUrl: string;
  readonly token: string | null;
  /** Mutable on purpose: a test can simulate a service restarted with a token. */
  authRequired: boolean;
  readonly rejectPaths: ReadonlySet<string>;
  offline = false;

  constructor(options: FakeBridgeOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'http://127.0.0.1:1423';
    this.token = options.token === undefined ? 'test-token' : options.token;
    this.authRequired = options.authRequired ?? true;
    this.rejectPaths = new Set(options.rejectPaths ?? []);
  }

  /** Adds a file to the fake file system. */
  addFile(path: string, content: string): void {
    this.files.set(path, content);
    let parent = path.slice(0, path.lastIndexOf('/'));
    while (parent.length > 0) {
      this.directories.add(parent);
      parent = parent.slice(0, parent.lastIndexOf('/'));
    }
  }

  /** The `fetch` implementation to hand over to the API client. */
  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (this.offline) {
      throw new TypeError('fetch failed');
    }

    const method = (init?.method ?? 'GET').toUpperCase();
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname;
    this.requests.push({ method, path });

    if (path === '/api/help') {
      return json({
        service: 'fake',
        version: '0.0.0',
        auth: {
          how: 'Authorization: Bearer <token> header (preferred) or ?token= query parameter.',
          open_routes: ['/', '/api/help', '/api/oauth2/callback', 'OPTIONS *'],
          required: this.authRequired ? 'b:true' : 'b:false',
        },
      });
    }
    if (path === '/') {
      return json({ service: 'fake', version: '0.0.0', help: '/api/help' });
    }

    if (this.authRequired && !this.isAuthorized(init)) {
      return json({ error: 'unauthorized', message: 'Valid API token required' }, 401);
    }
    if (this.rejectPaths.has(path)) {
      return json({ error: 'unauthorized', message: 'Valid API token required' }, 401);
    }

    const filePath = url.searchParams.get('path') ?? '';

    if (path === '/api/sysinfo' && method === 'GET') {
      return json({
        system: 'Linux',
        system_name: 'Linux',
        hostname: 'fake',
        cpu_count: 'i:4',
      });
    }
    if (path === '/api/dir' && method === 'GET') {
      return this.readDirectory(filePath);
    }
    if (path === '/api/file' && method === 'GET') {
      const content = this.files.get(filePath);
      if (content === undefined) {
        return json({ error: 'not_found', message: 'File not found' }, 404);
      }
      return json({
        path: filePath,
        absolute_path: filePath,
        content,
        size: `i:${content.length}`,
        mtime: 'f:0',
        mime_type: 'text/plain',
        is_binary: 'b:false',
        encoding: 'utf-8',
      });
    }
    if (path === '/api/file' && method === 'POST') {
      if (this.files.has(filePath)) {
        return json({ error: 'exists', message: 'File already exists' }, 409);
      }
      const body = parseBody(init?.body);
      this.addFile(filePath, String(body['content'] ?? ''));
      return json({ path: filePath, absolute_path: filePath }, 201);
    }
    if (path === '/api/file' && method === 'PUT') {
      if (!this.files.has(filePath)) {
        return json({ error: 'not_found', message: 'File not found' }, 404);
      }
      const body = parseBody(init?.body);
      this.files.set(filePath, String(body['content'] ?? ''));
      return json({ path: filePath, absolute_path: filePath });
    }
    if (path === '/api/file' && method === 'DELETE') {
      if (!this.files.has(filePath)) {
        return json({ error: 'not_found', message: 'File not found' }, 404);
      }
      this.files.delete(filePath);
      return json({ path: filePath, absolute_path: filePath, deleted: true });
    }
    if (path === '/api/shell' && method === 'POST') {
      return this.execShell(parseBody(init?.body));
    }

    return json({ error: 'not_found', message: 'Unknown route' }, 404);
  };

  /**
   * Checks the `Authorization` header of a request against the token of the
   * fake, the same way the real service does.
   */
  private isAuthorized(init: RequestInit | undefined): boolean {
    const header = new Headers(init?.headers).get('Authorization');
    if (this.token === null) {
      // The fake has no token: only a request without any token is accepted.
      return header === null;
    }
    return header === `Bearer ${this.token}`;
  }

  private readDirectory(path: string): Response {
    if (!this.directories.has(path)) {
      return json({ error: 'not_found', message: 'Directory not found' }, 404);
    }
    const prefix = path === '/' ? '/' : `${path}/`;
    const names = new Map<string, FakeEntry>();
    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(prefix)) {
        continue;
      }
      const rest = filePath.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) {
        names.set(rest, { type: 'file' });
      } else {
        names.set(rest.slice(0, slash), { type: 'dir' });
      }
    }
    const entries = [...names.entries()].map(([name, entry]) => ({
      name,
      path: `${prefix}${name}`,
      type: entry.type,
      size: `i:0`,
      mtime: 'f:0',
      mode: '0o644',
    }));
    return json({ path, absolute_path: path, count: `i:${entries.length}`, entries });
  }

  private execShell(body: Record<string, unknown>): Response {
    const command = String(body['command'] ?? '');
    const cwd = String(body['cwd'] ?? '/');
    const stdin = typeof body['stdin'] === 'string' ? (body['stdin'] as string) : '';

    let stdout = '';
    if (command.startsWith('find ')) {
      const prefix = cwd === '/' ? '/' : `${cwd}/`;
      stdout = [...this.files.keys()]
        .filter((filePath) => filePath.startsWith(prefix) && filePath.endsWith('.txt'))
        .filter((filePath) => filePath.slice(prefix.length).split('/').every((part) => /^task_\d+$/.test(part) || part.length > 0))
        .map((filePath) => `./${filePath.slice(prefix.length)}`)
        .join('\n');
      if (stdout.length > 0) {
        stdout = `${stdout}\n`;
      }
    } else if (command.includes('-rH') && command.includes("-e '^id='")) {
      // Reading the cards of the board: the metadata of every task.
      const prefix = cwd === '/' ? '/' : `${cwd}/`;
      const lines: string[] = [];
      for (const [filePath, content] of this.files) {
        if (!filePath.startsWith(prefix) || !filePath.endsWith('.txt')) {
          continue;
        }
        const relative = `./${filePath.slice(prefix.length)}`;
        for (const line of content.split('\n')) {
          if (line.trim() === '----') {
            break;
          }
          if (/^(id|parent|status|title|tags|start|end)=/u.test(line)) {
            lines.push(`${relative}:${line}`);
          }
        }
      }
      stdout = lines.length > 0 ? `${lines.join('\n')}\n` : '';
    } else if (command.includes('-rH') && command.includes("'^parent='")) {
      // Reading the hierarchy: one line per task that has a parent.
      const prefix = cwd === '/' ? '/' : `${cwd}/`;
      const lines: string[] = [];
      for (const [filePath, content] of this.files) {
        if (!filePath.startsWith(prefix) || !filePath.endsWith('.txt')) {
          continue;
        }
        const match = /^parent=(\d+)$/mu.exec(content);
        if (match === null) {
          continue;
        }
        lines.push(`./${filePath.slice(prefix.length)}:parent=${match[1] ?? ''}`);
      }
      stdout = lines.length > 0 ? `${lines.join('\n')}\n` : '';
    } else if (command.includes("'^parent='")) {
      // Counting the children of every task.
      const counts = new Map<string, number>();
      for (const content of this.files.values()) {
        const match = /^parent=(\d+)$/mu.exec(content);
        if (match === null) {
          continue;
        }
        const parentId = match[1] ?? '';
        counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
      }
      stdout = [...counts.entries()]
        .sort((left, right) => Number.parseInt(left[0], 10) - Number.parseInt(right[0], 10))
        .map(([parentId, count]) => `${String(count).padStart(7, ' ')} ${parentId}\n`)
        .join('');
    } else if (command.includes("-e '^parent=")) {
      // Listing the children of one task.
      const match = /-e '\^parent=(\d+)\$'/u.exec(command);
      const parentId = match?.[1] ?? '';
      const prefix = cwd === '/' ? '/' : `${cwd}/`;
      const matches = [...this.files.entries()]
        .filter(([filePath]) => filePath.startsWith(prefix) && filePath.endsWith('.txt'))
        .filter(([, content]) => new RegExp(`^parent=${parentId}$`, 'mu').test(content))
        .map(([filePath]) => `./${filePath.slice(prefix.length)}`);
      stdout = matches.length > 0 ? `${matches.join('\n')}\n` : '';
    } else if (command.startsWith('grep ')) {
      const pattern = stdin.split('\n')[0] ?? '';
      const lower = pattern.toLowerCase();
      const prefix = cwd === '/' ? '/' : `${cwd}/`;
      const matches = [...this.files.entries()]
        .filter(([filePath]) => filePath.startsWith(prefix) && filePath.endsWith('.txt'))
        .filter(([, content]) => content.toLowerCase().includes(lower))
        .map(([filePath]) => `./${filePath.slice(prefix.length)}`);
      stdout = matches.length > 0 ? `${matches.join('\n')}\n` : '';
    } else if (command.startsWith('mkdir ')) {
      stdout = '';
    } else if (command.includes('"$HOME"')) {
      stdout = '/home/user';
    }

    return json({
      command,
      cwd,
      returncode: 'i:0',
      stdout,
      stderr: '',
      timed_out: 'b:false',
      stdout_truncated: 'b:false',
      stderr_truncated: 'b:false',
      stdin_bytes: `i:${stdin.length}`,
    });
  }
}

function parseBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (body === null || body === undefined) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(String(body));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
