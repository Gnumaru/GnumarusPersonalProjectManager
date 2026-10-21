import { describe, expect, it } from 'vite-plus/test';
import { crc32, createZip, readZip } from './zip.js';

describe('crc32', () => {
  it('computes the checksum of a buffer', () => {
    const bytes = new TextEncoder().encode('123456789');

    // The check value of the CRC-32.
    expect(crc32(bytes)).toBe(0xcbf43926);
  });
});

describe('the ZIP archives', () => {
  it('writes the files and reads them back', () => {
    const files = [
      { path: 'task_1.txt', content: 'id=1\ntitle=First\n----\nThe body\n' },
      { path: 'nested/task_2.txt', content: 'id=2\ntitle=Second\n----\nAnother body\n' },
      { path: 'comment_1.txt', content: 'id=1\ntask=1\n----\nA comment\n' },
    ];

    const archive = createZip(files);
    const read = readZip(archive);

    expect(read).toHaveLength(3);
    expect(read.map((file) => file.path)).toEqual([
      'task_1.txt',
      'nested/task_2.txt',
      'comment_1.txt',
    ]);
    expect(read[0]?.content).toBe(files[0]?.content);
    expect(read[1]?.content).toBe(files[1]?.content);
    expect(read[2]?.content).toBe(files[2]?.content);
  });

  it('writes an empty archive', () => {
    const archive = createZip([]);

    expect(readZip(archive)).toEqual([]);
  });

  it('refuses a file that is not an archive', () => {
    const bytes = new TextEncoder().encode('this is not a zip file');

    expect(() => readZip(bytes)).toThrow('not a ZIP archive');
  });

  it('keeps the unicode characters', () => {
    const files = [{ path: 'task_1.txt', content: 'título=Relatório ✓\n' }];

    const read = readZip(createZip(files));

    expect(read[0]?.content).toBe('título=Relatório ✓\n');
  });
});
