import { describe, expect, it } from 'vite-plus/test';
import { compareEntries, formatSize, parentDirectory } from './fileDialog.js';
import type { DirectoryEntry } from '../api/client.js';

function entry(name: string): DirectoryEntry {
  return { name, path: `/tmp/${name}`, type: 'file', size: 0, mtime: 0 };
}

describe('parentDirectory', () => {
  it('returns the parent of a path', () => {
    expect(parentDirectory('/home/user/projects')).toBe('/home/user');
    expect(parentDirectory('/home/user/')).toBe('/home');
    expect(parentDirectory('/home')).toBe('/');
  });

  it('returns null for the root', () => {
    expect(parentDirectory('/')).toBeNull();
    expect(parentDirectory('')).toBeNull();
  });
});

describe('formatSize', () => {
  it('formats the sizes', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('compareEntries', () => {
  it('sorts the names in a natural order', () => {
    const names = ['task_10.txt', 'task_2.txt', 'task_1.txt'];
    const sorted = [...names].sort((left, right) =>
      compareEntries(entry(left), entry(right)),
    );
    expect(sorted).toEqual(['task_1.txt', 'task_2.txt', 'task_10.txt']);
  });
});
