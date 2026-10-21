import { describe, expect, it, vi } from 'vite-plus/test';
import { ApiClient, ApiError, ApiUnavailableError, decodeTagged, parseMountPoints } from './client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('decodeTagged', () => {
  it('decodes the tagged scalars', () => {
    expect(decodeTagged('i:42')).toBe(42);
    expect(decodeTagged('f:1.5')).toBe(1.5);
    expect(decodeTagged('s:text')).toBe('text');
    expect(decodeTagged('b:true')).toBe(true);
    expect(decodeTagged('b:false')).toBe(false);
    expect(decodeTagged('null')).toBeNull();
  });

  it('keeps plain values untouched', () => {
    expect(decodeTagged('plain')).toBe('plain');
    expect(decodeTagged(7)).toBe(7);
    expect(decodeTagged(null)).toBeNull();
  });
});

describe('parseMountPoints', () => {
  it('keeps the real file systems only', () => {
    const content = [
      '/dev/nvme0n1p2 / ext4 rw,relatime 0 0',
      'proc /proc proc rw 0 0',
      'sysfs /sys sysfs rw 0 0',
      '/dev/sda1 /boot/efi vfat rw 0 0',
      'tmpfs /run/user/1000 tmpfs rw 0 0',
    ].join('\n');
    expect(parseMountPoints(content)).toEqual(['/', '/boot/efi']);
  });
});

describe('ApiClient', () => {
  it('sends the token as a bearer header', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer secret-token');
      return jsonResponse({ content: 'hello', size: 'i:5', is_binary: 'b:false' });
    });
    const client = new ApiClient({ baseUrl: 'http://127.0.0.1:1423', token: 'secret-token', fetchImpl });

    const file = await client.readFile('/tmp/a.txt');

    expect(file.content).toBe('hello');
    expect(file.size).toBe(5);
    expect(file.isBinary).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('works without a token', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.has('Authorization')).toBe(false);
      return jsonResponse({ entries: [] });
    });
    const client = new ApiClient({ fetchImpl });
    await expect(client.readDirectory('/tmp')).resolves.toEqual([]);
  });

  it('decodes the directory entries', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        entries: [
          { name: 'a.txt', path: '/tmp/a.txt', type: 'file', size: 'i:12', mtime: 'f:1700000000' },
          { name: 'sub', path: '/tmp/sub', type: 'dir', size: 'i:4096', mtime: 'f:1700000001' },
        ],
      }),
    );
    const client = new ApiClient({ fetchImpl });

    const entries = await client.readDirectory('/tmp');

    expect(entries).toHaveLength(2);
    expect(entries[0]?.name).toBe('a.txt');
    expect(entries[0]?.type).toBe('file');
    expect(entries[0]?.size).toBe(12);
    expect(entries[1]?.type).toBe('dir');
  });

  it('raises an ApiError with the message of the service', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'unauthorized', message: 'Valid API token required' }, 401),
    );
    const client = new ApiClient({ fetchImpl });

    await expect(client.readFile('/tmp/a.txt')).rejects.toBeInstanceOf(ApiError);
    await expect(client.readFile('/tmp/a.txt')).rejects.toThrow('Valid API token required');
  });

  it('raises an ApiUnavailableError when the service is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const client = new ApiClient({ fetchImpl });

    await expect(client.readDirectory('/tmp')).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it('creates, overwrites and deletes files', async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? 'GET',
        url: String(url),
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      });
      return jsonResponse({ path: '/tmp/a.txt' }, 201);
    });
    const client = new ApiClient({ fetchImpl });

    await client.createFile('/tmp/a.txt', 'body');
    await client.overwriteFile('/tmp/a.txt', 'other');
    await client.deleteFile('/tmp/a.txt');

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toEqual({ content: 'body', encoding: 'text' });
    expect(calls[1]?.method).toBe('PUT');
    expect(calls[2]?.method).toBe('DELETE');
  });

  it('overwrites an existing file when it already exists', async () => {
    const methods: string[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      methods.push(method);
      if (method === 'POST') {
        return jsonResponse({ error: 'exists' }, 409);
      }
      return jsonResponse({ path: '/tmp/a.txt' });
    });
    const client = new ApiClient({ fetchImpl });

    await client.writeFileEnsuring('/tmp/a.txt', 'body');

    expect(methods).toEqual(['POST', 'PUT']);
  });

  it('runs a shell command and decodes the result', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        command: 'ls',
        cwd: '/tmp',
        returncode: 'i:0',
        stdout: 'a.txt\n',
        stderr: '',
        timed_out: 'b:false',
        stdout_truncated: 'b:false',
        stderr_truncated: 'b:false',
      }),
    );
    const client = new ApiClient({ fetchImpl });

    const result = await client.execShell({ command: 'ls', cwd: '/tmp' });

    expect(result.returncode).toBe(0);
    expect(result.stdout).toBe('a.txt\n');
    expect(result.timedOut).toBe(false);
  });

  it('reports an unreachable service when pinging', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const client = new ApiClient({ fetchImpl });
    await expect(client.ping()).resolves.toBe(false);
  });

  it('reports an available service when pinging', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ service: 'ok' }));
    const client = new ApiClient({ fetchImpl });
    await expect(client.ping()).resolves.toBe(true);
  });
});
