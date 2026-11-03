import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { formatLogMoment, logAction } from './log.js';

describe('formatLogMoment', () => {
  it('writes the moment as an ISO timestamp with milliseconds', () => {
    expect(formatLogMoment(new Date('2026-11-03T14:05:09.123Z'))).toBe(
      '2026-11-03T14:05:09.123Z',
    );
  });
});

describe('logAction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefixes every message with the moment of the log', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    logAction('Trying to reach Supabase.');

    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0]?.[0];
    expect(typeof line).toBe('string');
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] Trying to reach Supabase\.$/u);
  });

  it('passes the detail as a second console argument', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const detail = { table: 'tasks' };
    logAction('Checking a table.', detail);

    expect(log).toHaveBeenCalledWith(expect.stringContaining('Checking a table.'), detail);
  });
});
