import { describe, expect, it } from 'vite-plus/test';
import {
  applyTaskInput,
  buildTask,
  dateInputValue,
  dateInputValueOfDate,
  formatTaskTimestamp,
  isTaskFileName,
  isTaskStatus,
  isDimmedStatus,
  isValidTag,
  METADATA_SEPARATOR,
  normalizeTags,
  normalizeTaskTimestamp,
  parseIdList,
  parseTask,
  parseTaskIdFromFileName,
  parseTaskTimestamp,
  serializeTask,
  withDefaultDates,
  TASK_ROLES,
  TASK_STATUSES,
  TASK_TYPES,
  isTaskRole,
  isTaskType,
  taskFileName,
  timestampFromDateInput,
  withParent,
  withExpandedState,
  withKanbanHidden,
  withTreeGanttHidden,
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

describe('the compact timestamps', () => {
  it('writes the year, the month, the day, the hour, the minute, the second and the millisecond', () => {
    const date = new Date(2026, 9, 21, 2, 45, 29, 365);

    expect(formatTaskTimestamp(date)).toBe('20261021024529365');
    expect(formatTaskTimestamp(date)).toHaveLength(17);
  });

  it('writes the local time, without any timezone', () => {
    const date = new Date(2026, 0, 2, 3, 4, 5, 6);

    expect(formatTaskTimestamp(date)).toBe('20260102030405006');
  });

  it('reads back what it wrote', () => {
    const date = new Date(2026, 9, 21, 2, 45, 29, 365);
    const parsed = parseTaskTimestamp(formatTaskTimestamp(date));

    expect(parsed).not.toBeNull();
    expect(parsed?.getTime()).toBe(date.getTime());
  });

  it('rejects the dates that do not exist', () => {
    expect(parseTaskTimestamp('20260231000000000')).toBeNull();
    expect(parseTaskTimestamp('20261301000000000')).toBeNull();
    expect(parseTaskTimestamp('not a date')).toBeNull();
    expect(parseTaskTimestamp('')).toBeNull();
  });

  it('still reads the old ISO format', () => {
    const parsed = parseTaskTimestamp('2026-10-21T02:45:29.365Z');

    expect(parsed).not.toBeNull();
    expect(parsed?.getTime()).toBe(new Date('2026-10-21T02:45:29.365Z').getTime());
  });

  it('normalizes an unknown value to an empty string', () => {
    expect(normalizeTaskTimestamp('')).toBe('');
    expect(normalizeTaskTimestamp('nonsense')).toBe('');
    expect(normalizeTaskTimestamp('20261021024529365')).toBe('20261021024529365');
  });
});

describe('the date pickers', () => {
  it('gives the value of the picker for a timestamp', () => {
    expect(dateInputValue('20261019100000000')).toBe('2026-10-19');
    expect(dateInputValue('')).toBe('');
    expect(dateInputValue('nonsense')).toBe('');
  });

  it('gives the value of the picker for a local date', () => {
    expect(dateInputValueOfDate(new Date(2026, 9, 24, 15, 45, 30))).toBe('2026-10-24');
    expect(dateInputValueOfDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('reads the value of the picker as a timestamp', () => {
    expect(timestampFromDateInput('2026-10-19')).toBe('20261019000000000');
    expect(timestampFromDateInput('')).toBe('');
    expect(timestampFromDateInput('nonsense')).toBe('');
  });

  it('rejects the dates that do not exist', () => {
    expect(timestampFromDateInput('2026-02-31')).toBe('');
    expect(timestampFromDateInput('2026-13-01')).toBe('');
  });

  it('keeps the dates of a task that is edited', () => {
    const now = new Date(2026, 4, 5, 10, 0, 0, 0);
    const original = buildTask(
      {
        title: 'Dated',
        description: '',
        status: 'todo',
        tags: [],
        start: '20261001000000000',
        end: '20261020000000000',
        blockedBy: [],
        related: [],
      },
      3,
      now,
    );
    expect(original.start).toBe('20261001000000000');
    expect(original.end).toBe('20261020000000000');

    const updated = applyTaskInput(
      original,
      {
        title: 'Dated',
        description: '',
        status: 'doing',
        tags: [],
        start: '20261101000000000',
        end: '20261120000000000',
        blockedBy: [],
        related: [],
      },
      now,
    );
    expect(updated.start).toBe('20261101000000000');
    expect(updated.end).toBe('20261120000000000');
  });
});

describe('the blocking and the related tasks', () => {
  it('parses a list of ids', () => {
    expect(parseIdList('3,5, 7')).toEqual([3, 5, 7]);
    expect(parseIdList('')).toEqual([]);
    expect(parseIdList('3, 3, 5')).toEqual([3, 5]);
    expect(parseIdList('0,-2,abc')).toEqual([]);
  });

  it('reads the relations of a task', () => {
    const task = parseTask(
      [
        'id=1',
        'title=Blocked',
        'blocked_by=3,5',
        'related=7,9',
        '----',
        'body',
      ].join('\n'),
    );

    expect(task.blockedBy).toEqual([3, 5]);
    expect(task.related).toEqual([7, 9]);
  });

  it('has no relation when the keys are missing', () => {
    const task = parseTask('id=1\ntitle=Alone\n----\nbody');

    expect(task.blockedBy).toEqual([]);
    expect(task.related).toEqual([]);
  });

  it('writes the relations only when there are some', () => {
    const base = {
      id: 1,
      title: 'T',
      status: 'todo' as const,
      parentId: null,
      tags: [],
      created: '',
      updated: '',
      start: '',
      end: '',
      blockedBy: [] as number[],
      related: [] as number[],
      expanded: false,
      kanbanHidden: false,
      treeGanttHidden: false,
      kanbanOrder: 0,
      treeGanttOrder: 0,
      description: '',
    };

    expect(serializeTask(base)).not.toContain('blocked_by');
    expect(serializeTask(base)).not.toContain('related=');
    expect(serializeTask({ ...base, blockedBy: [3, 5] })).toContain('blocked_by=3,5');
    expect(serializeTask({ ...base, related: [7] })).toContain('related=7');
  });

  it('keeps the relations when a task is edited', () => {
    const now = new Date(2026, 4, 5, 10, 0, 0, 0);
    const original = buildTask(
      {
        title: 'Related',
        description: '',
        status: 'todo',
        tags: [],
        start: '',
        end: '',
        blockedBy: [3],
        related: [7],
      },
      2,
      now,
    );

    expect(original.blockedBy).toEqual([3]);
    expect(original.related).toEqual([7]);

    const updated = applyTaskInput(
      original,
      {
        title: 'Related',
        description: '',
        status: 'doing',
        tags: [],
        start: '',
        end: '',
        blockedBy: [4, 5],
        related: [8],
      },
      now,
    );

    expect(updated.blockedBy).toEqual([4, 5]);
    expect(updated.related).toEqual([8]);
  });
});

describe('task statuses', () => {
  it('knows every status of the application', () => {
    expect([...TASK_STATUSES]).toEqual([
      'planning',
      'next',
      'todo',
      'doing',
      'paused',
      'done',
      'canceled',
    ]);
  });

  it('accepts only the known statuses', () => {
    for (const status of TASK_STATUSES) {
      expect(isTaskStatus(status)).toBe(true);
    }
    expect(isTaskStatus('whatever')).toBe(false);
    expect(isTaskStatus('')).toBe(false);
  });

  it('dims only the planning, done and canceled statuses', () => {
    expect(isDimmedStatus('planning')).toBe(true);
    expect(isDimmedStatus('done')).toBe(true);
    expect(isDimmedStatus('canceled')).toBe(true);
    expect(isDimmedStatus('todo')).toBe(false);
    expect(isDimmedStatus('doing')).toBe(false);
    expect(isDimmedStatus('next')).toBe(false);
    expect(isDimmedStatus('paused')).toBe(false);
  });
});

describe('task types and roles', () => {
  it('knows every type and role of the application', () => {
    expect([...TASK_TYPES]).toEqual(['Bug', 'Improvement', 'Feature']);
    expect([...TASK_ROLES]).toEqual([
      'Graphics',
      'Audio',
      'Programming',
      'Design',
      'Assembly',
      'Management',
      'Test',
      'Research',
    ]);
  });

  it('accepts only the known types and roles', () => {
    for (const type of TASK_TYPES) {
      expect(isTaskType(type)).toBe(true);
    }
    expect(isTaskType('whatever')).toBe(false);
    for (const role of TASK_ROLES) {
      expect(isTaskRole(role)).toBe(true);
    }
    expect(isTaskRole('whatever')).toBe(false);
  });
});

describe('parseTask', () => {
  it('reads the metadata and the description', () => {
    const content = [
      'id=3',
      'title=Write the docs',
      'status=doing',
      'tags=docs writing',
      'created=20261020100000000',
      'updated=20261021113000000',
      'start=20261020110000000',
      'end=20261021120000000',
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
    expect(task.created).toBe('20261020100000000');
    expect(task.updated).toBe('20261021113000000');
    expect(task.start).toBe('20261020110000000');
    expect(task.end).toBe('20261021120000000');
    expect(task.description).toBe('First line\n\nSecond paragraph');
  });

  it('reads the dates written in the old ISO format', () => {
    const task = parseTask('id=1\ncreated=2026-10-20T10:00:00.000Z\n----\nbody');

    expect(task.created).toMatch(/^\d{17}$/u);
    expect(parseTaskTimestamp(task.created)?.getTime()).toBe(
      new Date('2026-10-20T10:00:00.000Z').getTime(),
    );
  });

  it('leaves the start and the end empty when they are not written', () => {
    const task = parseTask('id=1\ntitle=T\n----\nbody');
    expect(task.start).toBe('');
    expect(task.end).toBe('');
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

  it('reads every known status', () => {
    for (const status of TASK_STATUSES) {
      expect(parseTask(`id=1\nstatus=${status}\n----`).status).toBe(status);
    }
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
      created: '20261020100000000',
      updated: '20261020100000000',
      start: '20261020110000000',
      end: '20261021120000000',
      description: 'Some description',
      blockedBy: [],
      related: [],
      expanded: false,
      kanbanHidden: false,
      treeGanttHidden: false,
      kanbanOrder: 0,
      treeGanttOrder: 0,
      type: 'Feature' as const,
      role: 'Programming' as const,
    };

    expect(serializeTask(task)).toBe(
      [
        'id=12',
        'title=Implement pagination',
        'status=todo',
        'tags=frontend ui',
        'created=20261020100000000',
        'updated=20261020100000000',
        'start=20261020110000000',
        'end=20261021120000000',
        'type=Feature',
        'role=Programming',
        'kanban_order=0',
        'tree_gantt_order=0',
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
      start: '',
      end: '',
      description: '',
      blockedBy: [],
      related: [],
      expanded: false,
      kanbanHidden: false,
      treeGanttHidden: false,
      kanbanOrder: 0,
      treeGanttOrder: 0,
      type: 'Feature' as const,
      role: 'Programming' as const,
    };
    expect(serializeTask({ ...base, parentId: null })).not.toContain('parent=');
    expect(serializeTask({ ...base, parentId: 4 })).toContain('parent=4');
  });

  it('writes the expanded key only when the branch is expanded', () => {
    const base = {
      id: 1,
      title: 'T',
      status: 'todo' as const,
      parentId: null,
      tags: [],
      created: '',
      updated: '',
      start: '',
      end: '',
      description: '',
      blockedBy: [],
      related: [],
    };
    expect(serializeTask({ ...base, expanded: false })).not.toContain('expanded=');
    expect(serializeTask({ ...base, expanded: true })).toContain('expanded=true');
  });

  it('parses the expanded key and leaves it out when it is collapsed', () => {
    expect(parseTask('id=1\nexpanded=true\n----\nbody').expanded).toBe(true);
    expect(parseTask('id=1\n----\nbody').expanded).toBe(false);
    expect(parseTask('id=1\nexpanded=false\n----\nbody').expanded).toBe(false);
  });

  it('writes the kanban_hidden key only when the card is hidden', () => {
    const base = {
      id: 1,
      title: 'T',
      status: 'todo' as const,
      parentId: null,
      tags: [],
      created: '',
      updated: '',
      start: '',
      end: '',
      description: '',
      blockedBy: [],
      related: [],
    };
    expect(serializeTask({ ...base, expanded: false, kanbanHidden: false })).not.toContain(
      'kanban_hidden=',
    );
    expect(serializeTask({ ...base, expanded: false, kanbanHidden: true })).toContain(
      'kanban_hidden=true',
    );
  });

  it('parses the kanban_hidden key, visible when absent', () => {
    expect(parseTask('id=1\nkanban_hidden=true\n----\nbody').kanbanHidden).toBe(true);
    expect(parseTask('id=1\n----\nbody').kanbanHidden).toBe(false);
    expect(parseTask('id=1\nkanban_hidden=false\n----\nbody').kanbanHidden).toBe(false);
  });

  it('writes the tree_gantt_hidden key only when the task is hidden', () => {
    const base = {
      id: 1,
      title: 'T',
      status: 'todo' as const,
      parentId: null,
      tags: [],
      created: '',
      updated: '',
      start: '',
      end: '',
      description: '',
      blockedBy: [],
      related: [],
    };
    expect(
      serializeTask({ ...base, expanded: false, kanbanHidden: false, treeGanttHidden: false }),
    ).not.toContain('tree_gantt_hidden=');
    expect(
      serializeTask({ ...base, expanded: false, kanbanHidden: false, treeGanttHidden: true }),
    ).toContain('tree_gantt_hidden=true');
  });

  it('parses the tree_gantt_hidden key, visible when absent', () => {
    expect(parseTask('id=1\ntree_gantt_hidden=true\n----\nbody').treeGanttHidden).toBe(true);
    expect(parseTask('id=1\n----\nbody').treeGanttHidden).toBe(false);
    expect(parseTask('id=1\ntree_gantt_hidden=false\n----\nbody').treeGanttHidden).toBe(false);
  });

  it('keeps the hidden state without touching the update timestamp', () => {
    const task = parseTask('id=1\nupdated=20261002100000000\n----\nbody');
    const hidden = withKanbanHidden(task, true);
    expect(hidden.kanbanHidden).toBe(true);
    expect(hidden.updated).toBe('20261002100000000');
    expect(withKanbanHidden(hidden, false).kanbanHidden).toBe(false);
    const treeHidden = withTreeGanttHidden(task, true);
    expect(treeHidden.treeGanttHidden).toBe(true);
    expect(treeHidden.updated).toBe('20261002100000000');
    expect(withTreeGanttHidden(treeHidden, false).treeGanttHidden).toBe(false);
  });

  it('does not change the update time when the expanded state changes', () => {
    const base = {
      id: 1,
      title: 'T',
      status: 'todo' as const,
      parentId: null,
      tags: [],
      created: '20260101000000000',
      updated: '20260202000000000',
      start: '',
      end: '',
      description: '',
      blockedBy: [],
      related: [],
      expanded: false,
      kanbanHidden: false,
      treeGanttHidden: false,
      kanbanOrder: 0,
      treeGanttOrder: 0,
      type: 'Feature' as const,
      role: 'Programming' as const,
    };
    const expanded = withExpandedState(base, true);
    expect(expanded).toEqual({ ...base, expanded: true });
    const collapsed = withExpandedState(expanded, false);
    expect(collapsed.updated).toBe('20260202000000000');
  });

  it('assigns today and tomorrow to the dates a task does not have', () => {
    const now = new Date(2026, 4, 5, 15, 30, 0, 0);
    const task = {
      id: 1,
      title: 'T',
      status: 'todo' as const,
      parentId: null,
      tags: [],
      created: '',
      updated: '20260101000000000',
      start: '',
      end: '',
      description: '',
      blockedBy: [],
      related: [],
      expanded: false,
      kanbanHidden: false,
      treeGanttHidden: false,
      kanbanOrder: 0,
      treeGanttOrder: 0,
      type: 'Feature' as const,
      role: 'Programming' as const,
    };
    const seeded = withDefaultDates(task, now);
    expect(seeded.start).toBe(formatTaskTimestamp(new Date(2026, 4, 5, 0, 0, 0, 0)));
    expect(seeded.end).toBe(formatTaskTimestamp(new Date(2026, 4, 6, 0, 0, 0, 0)));
    // The change is not an edit of the user: the update time stays.
    expect(seeded.updated).toBe('20260101000000000');
  });

  it('keeps the dates a task already has', () => {
    const now = new Date();
    const task = {
      id: 1,
      title: 'T',
      status: 'todo' as const,
      parentId: null,
      tags: [],
      created: '',
      updated: '',
      start: '20250101100000000',
      end: '',
      blockedBy: [],
      related: [],
      expanded: false,
      kanbanHidden: false,
      treeGanttHidden: false,
      kanbanOrder: 0,
      treeGanttOrder: 0,
      description: '',
    };
    const seeded = withDefaultDates(task, now);
    expect(seeded.start).toBe('20250101100000000');
    expect(seeded.end).toBe(formatTaskTimestamp(midnightOfNextDay(now)));
  });

  function midnightOfNextDay(now: Date): Date {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const copy = new Date(tomorrow);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  it('keeps a title on a single line', () => {
    const task = {
      id: 1,
      title: 'first\nsecond',
      status: 'todo' as const,
      parentId: null,
      tags: [],
      created: '',
      updated: '',
      start: '',
      end: '',
      description: '',
      blockedBy: [],
      related: [],
      expanded: false,
      kanbanHidden: false,
      treeGanttHidden: false,
      kanbanOrder: 0,
      treeGanttOrder: 0,
      type: 'Feature' as const,
      role: 'Programming' as const,
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
      created: '20260101000000000',
      updated: '20260102000000000',
      start: '20260103000000000',
      end: '20260104000000000',
      description: 'Line one\nLine two',
      blockedBy: [],
      related: [],
      expanded: false,
      kanbanHidden: false,
      treeGanttHidden: false,
      kanbanOrder: 0,
      treeGanttOrder: 0,
      type: 'Feature' as const,
      role: 'Programming' as const,
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
      start: '',
      end: '',
      description: 'a=b\nc ---- d',
      blockedBy: [],
      related: [],
      expanded: false,
      kanbanHidden: false,
      treeGanttHidden: false,
      kanbanOrder: 0,
      treeGanttOrder: 0,
      type: 'Feature' as const,
      role: 'Programming' as const,
    };
    expect(parseTask(serializeTask(original))).toEqual(original);
  });
});

describe('buildTask and applyTaskInput', () => {
  it('stamps the creation and update time', () => {
    const now = new Date(2026, 4, 5, 10, 0, 0, 0);
    const task = buildTask(
      { title: '  Trimmed  ', description: 'body', status: 'todo', tags: ['x', 'y'], start: '', end: '', blockedBy: [], related: [] },
      3,
      now,
    );
    expect(task.id).toBe(3);
    expect(task.title).toBe('Trimmed');
    expect(task.tags).toEqual(['x', 'y']);
    expect(task.created).toBe('20260505100000000');
    expect(task.updated).toBe('20260505100000000');
    expect(task.parentId).toBeNull();
    expect(task.start).toBe('');
    expect(task.end).toBe('');
  });

  it('builds a child task that points to its parent', () => {
    const task = buildTask(
      { title: 'Child', description: '', status: 'todo', tags: [], start: '', end: '', blockedBy: [], related: [] },
      4,
      new Date('2026-05-05T10:00:00.000Z'),
      3,
    );
    expect(task.parentId).toBe(3);
    expect(serializeTask(task)).toContain('parent=3');
    expect(parseTask(serializeTask(task)).parentId).toBe(3);
  });

  it('keeps the id and the creation time when editing', () => {
    const now = new Date(2026, 4, 5, 10, 0, 0, 0);
    const original = buildTask(
      { title: 'First', description: 'body', status: 'todo', tags: [], start: '', end: '', blockedBy: [], related: [] },
      9,
      new Date(2026, 0, 1, 0, 0, 0, 0),
    );
    const updated = applyTaskInput(
      original,
      { title: 'Second', description: 'new body', status: 'done', tags: ['t'], start: '', end: '', blockedBy: [], related: [] },
      now,
    );
    expect(updated.id).toBe(9);
    expect(updated.created).toBe('20260101000000000');
    expect(updated.updated).toBe('20260505100000000');
    expect(updated.title).toBe('Second');
    expect(updated.status).toBe('done');
    expect(updated.tags).toEqual(['t']);
  });
});

describe('withParent', () => {
  const original = buildTask(
    { title: 'Movable', description: 'body', status: 'todo', tags: ['t'], start: '', end: '', blockedBy: [], related: [] },
    7,
    new Date(2026, 0, 1, 0, 0, 0, 0),
    3,
  );

  it('moves a task under another parent', () => {
    const moved = withParent(original, 5, new Date(2026, 4, 5, 10, 0, 0, 0));

    expect(moved.parentId).toBe(5);
    expect(moved.id).toBe(7);
    expect(moved.title).toBe('Movable');
    expect(moved.tags).toEqual(['t']);
    expect(moved.created).toBe('20260101000000000');
    expect(moved.updated).toBe('20260505100000000');
    expect(serializeTask(moved)).toContain('parent=5');
  });

  it('makes a task a root task again', () => {
    const moved = withParent(original, null, new Date(2026, 4, 5, 10, 0, 0, 0));

    expect(moved.parentId).toBeNull();
    expect(serializeTask(moved)).not.toContain('parent=');
  });
});
