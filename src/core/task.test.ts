import { describe, expect, it } from 'vite-plus/test';
import {
  applyTaskInput,
  buildTask,
  isTaskFileName,
  isValidTag,
  METADATA_SEPARATOR,
  normalizeTags,
  parseTask,
  parseTaskIdFromFileName,
  serializeTask,
  taskFileName,
  withParent,
} from './task.js';

describe('task file names', () => {
  it('builds the file name out of the id', () => {
    expect(taskFileName(7)).toBe('task_7.txt');
    expect(taskFileName(123)).toBe('task_123.txt');
  });

  it('recognizes task file names', () => {
    expect(isTaskFileName('task_1.txt')).toBe(true);
    expect(isTaskFileName('task_42.txt')).toBe(true);
    expect(isTaskFileName('task_.txt')).toBe(false);
    expect(isTaskFileName('task_1.md')).toBe(false);
    expect(isTaskFileName('notes.txt')).toBe(false);
    expect(isTaskFileName('task_1.txt.bak')).toBe(false);
  });

  it('extracts the id from the file name', () => {
    expect(parseTaskIdFromFileName('task_9.txt')).toBe(9);
    expect(parseTaskIdFromFileName('task_1234.txt')).toBe(1234);
    expect(parseTaskIdFromFileName('task_x.txt')).toBeNull();
    expect(parseTaskIdFromFileName('readme.txt')).toBeNull();
  });
});

describe('tag handling', () => {
  it('splits tags on white space', () => {
    expect(normalizeTags('frontend ui api')).toEqual(['frontend', 'ui', 'api']);
    expect(normalizeTags('  spaced   out  ')).toEqual(['spaced', 'out']);
  });

  it('removes duplicated tags and keeps the order', () => {
    expect(normalizeTags('b a b c a')).toEqual(['b', 'a', 'c']);
  });

  it('accepts an array of tags', () => {
    expect(normalizeTags(['one', 'two', 'one'])).toEqual(['one', 'two']);
  });

  it('rejects tags containing white space', () => {
    expect(isValidTag('valid-tag')).toBe(true);
    expect(isValidTag('in valid')).toBe(false);
    expect(isValidTag('')).toBe(false);
  });
});

describe('parseTask', () => {
  it('reads the metadata and the description', () => {
    const content = [
      'id=3',
      'title=Write the docs',
      'status=doing',
      'tags=docs writing',
      'created=2026-10-20T10:00:00.000Z',
      'updated=2026-10-21T11:30:00.000Z',
      METADATA_SEPARATOR,
      'First line',
      '',
      'Second paragraph',
    ].join('\n');

    const task = parseTask(content);

    expect(task.id).toBe(3);
    expect(task.title).toBe('Write the docs');
    expect(task.status).toBe('doing');
    expect(task.tags).toEqual(['docs', 'writing']);
    expect(task.created).toBe('2026-10-20T10:00:00.000Z');
    expect(task.updated).toBe('2026-10-21T11:30:00.000Z');
    expect(task.description).toBe('First line\n\nSecond paragraph');
  });

  it('treats a task without parent key as a root task', () => {
    const task = parseTask('id=1\ntitle=Root\n----\nbody');
    expect(task.parentId).toBeNull();
  });

  it('reads the parent id when present', () => {
    const task = parseTask('id=2\ntitle=Child\nparent=1\n----\nbody');
    expect(task.parentId).toBe(1);
  });

  it('ignores an empty parent value', () => {
    const task = parseTask('id=2\ntitle=Child\nparent=\n----\nbody');
    expect(task.parentId).toBeNull();
  });

  it('falls back to the id hint when the file has no id key', () => {
    const task = parseTask('title=No id\n----\nbody', 42);
    expect(task.id).toBe(42);
  });

  it('uses the todo status for unknown values', () => {
    expect(parseTask('id=1\nstatus=whatever\n----').status).toBe('todo');
  });

  it('keeps a description that contains the separator', () => {
    const task = parseTask('id=1\ntitle=T\n----\nbefore\n----\nafter');
    expect(task.description).toBe('before\n----\nafter');
  });

  it('handles windows line endings', () => {
    const task = parseTask('id=5\r\ntitle=CRLF\r\n----\r\nbody\r\n');
    expect(task.id).toBe(5);
    expect(task.title).toBe('CRLF');
    expect(task.description).toBe('body');
  });

  it('accepts a file without any metadata', () => {
    const task = parseTask('just some text');
    expect(task.title).toBe('');
    expect(task.description).toBe('just some text');
  });
});

describe('serializeTask', () => {
  it('writes the metadata block and the description', () => {
    const task = {
      id: 12,
      title: 'Implement pagination',
      status: 'todo' as const,
      parentId: null,
      tags: ['frontend', 'ui'],
      created: '2026-10-20T10:00:00.000Z',
      updated: '2026-10-20T10:00:00.000Z',
      description: 'Some description',
    };

    expect(serializeTask(task)).toBe(
      [
        'id=12',
        'title=Implement pagination',
        'status=todo',
        'tags=frontend ui',
        'created=2026-10-20T10:00:00.000Z',
        'updated=2026-10-20T10:00:00.000Z',
        METADATA_SEPARATOR,
        'Some description',
        '',
      ].join('\n'),
    );
  });

  it('writes the parent key only for child tasks', () => {
    const base = {
      id: 1,
      title: 'T',
      status: 'todo' as const,
      tags: [],
      created: '',
      updated: '',
      description: '',
    };
    expect(serializeTask({ ...base, parentId: null })).not.toContain('parent=');
    expect(serializeTask({ ...base, parentId: 4 })).toContain('parent=4');
  });

  it('keeps a title on a single line', () => {
    const task = {
      id: 1,
      title: 'first\nsecond',
      status: 'todo' as const,
      parentId: null,
      tags: [],
      created: '',
      updated: '',
      description: '',
    };
    const content = serializeTask(task);
    expect(content).toContain('title=first second');
    expect(content.split('\n')[0]).toBe('id=1');
  });
});

describe('round trip', () => {
  it('parses back what it serialized', () => {
    const original = {
      id: 21,
      title: 'Round trip',
      status: 'done' as const,
      parentId: null,
      tags: ['a', 'b'],
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-02T00:00:00.000Z',
      description: 'Line one\nLine two',
    };

    const parsed = parseTask(serializeTask(original));
    expect(parsed).toEqual(original);
  });

  it('keeps a description with special characters', () => {
    const original = {
      id: 22,
      title: 'Special = chars: and ; signs',
      status: 'doing' as const,
      parentId: null,
      tags: [],
      created: '',
      updated: '',
      description: 'a=b\nc ---- d',
    };
    expect(parseTask(serializeTask(original))).toEqual(original);
  });
});

describe('buildTask and applyTaskInput', () => {
  it('stamps the creation and update time', () => {
    const now = new Date('2026-05-05T10:00:00.000Z');
    const task = buildTask(
      { title: '  Trimmed  ', description: 'body', status: 'todo', tags: ['x', 'y'] },
      3,
      now,
    );
    expect(task.id).toBe(3);
    expect(task.title).toBe('Trimmed');
    expect(task.tags).toEqual(['x', 'y']);
    expect(task.created).toBe('2026-05-05T10:00:00.000Z');
    expect(task.updated).toBe('2026-05-05T10:00:00.000Z');
    expect(task.parentId).toBeNull();
  });

  it('builds a child task that points to its parent', () => {
    const task = buildTask(
      { title: 'Child', description: '', status: 'todo', tags: [] },
      4,
      new Date('2026-05-05T10:00:00.000Z'),
      3,
    );
    expect(task.parentId).toBe(3);
    expect(serializeTask(task)).toContain('parent=3');
    expect(parseTask(serializeTask(task)).parentId).toBe(3);
  });

  it('keeps the id and the creation time when editing', () => {
    const now = new Date('2026-05-05T10:00:00.000Z');
    const original = buildTask(
      { title: 'First', description: 'body', status: 'todo', tags: [] },
      9,
      new Date('2026-01-01T00:00:00.000Z'),
    );
    const updated = applyTaskInput(
      original,
      { title: 'Second', description: 'new body', status: 'done', tags: ['t'] },
      now,
    );
    expect(updated.id).toBe(9);
    expect(updated.created).toBe('2026-01-01T00:00:00.000Z');
    expect(updated.updated).toBe('2026-05-05T10:00:00.000Z');
    expect(updated.title).toBe('Second');
    expect(updated.status).toBe('done');
    expect(updated.tags).toEqual(['t']);
  });
});

describe('withParent', () => {
  const original = buildTask(
    { title: 'Movable', description: 'body', status: 'todo', tags: ['t'] },
    7,
    new Date('2026-01-01T00:00:00.000Z'),
    3,
  );

  it('moves a task under another parent', () => {
    const moved = withParent(original, 5, new Date('2026-05-05T10:00:00.000Z'));

    expect(moved.parentId).toBe(5);
    expect(moved.id).toBe(7);
    expect(moved.title).toBe('Movable');
    expect(moved.tags).toEqual(['t']);
    expect(moved.created).toBe('2026-01-01T00:00:00.000Z');
    expect(moved.updated).toBe('2026-05-05T10:00:00.000Z');
    expect(serializeTask(moved)).toContain('parent=5');
  });

  it('makes a task a root task again', () => {
    const moved = withParent(original, null, new Date('2026-05-05T10:00:00.000Z'));

    expect(moved.parentId).toBeNull();
    expect(serializeTask(moved)).not.toContain('parent=');
  });
});
