import { describe, expect, it } from 'vite-plus/test';
import {
  buildComment,
  commentFileName,
  isCommentFileName,
  parseComment,
  parseCommentIdFromFileName,
  serializeComment,
  sortComments,
  type TaskComment,
} from './comment.js';

describe('the comment file names', () => {
  it('builds the name out of the id', () => {
    expect(commentFileName(7)).toBe('comment_7.txt');
  });

  it('recognizes the names', () => {
    expect(isCommentFileName('comment_7.txt')).toBe(true);
    expect(isCommentFileName('task_7.txt')).toBe(false);
    expect(isCommentFileName('comment_.txt')).toBe(false);
  });

  it('extracts the id from the name', () => {
    expect(parseCommentIdFromFileName('comment_12.txt')).toBe(12);
    expect(parseCommentIdFromFileName('comment_x.txt')).toBeNull();
  });
});

describe('parseComment', () => {
  it('reads the metadata and the text', () => {
    const content = [
      'id=3',
      'task=12',
      'created=20261021024529365',
      'updated=20261022000000000',
      '----',
      'The first line',
      '',
      'The second line',
    ].join('\n');

    const comment = parseComment(content);

    expect(comment.id).toBe(3);
    expect(comment.taskId).toBe(12);
    expect(comment.created).toBe('20261021024529365');
    expect(comment.updated).toBe('20261022000000000');
    expect(comment.text).toBe('The first line\n\nThe second line');
  });

  it('uses the file name when the file has no id', () => {
    const comment = parseComment('task=5\n----\nBody', 9);

    expect(comment.id).toBe(9);
    expect(comment.taskId).toBe(5);
    expect(comment.text).toBe('Body');
  });

  it('reads the old ISO format', () => {
    const comment = parseComment('id=1\ntask=2\ncreated=2026-10-21T02:45:29.365Z\n----\nBody');

    expect(comment.created).toMatch(/^\d{17}$/u);
  });
});

describe('serializeComment', () => {
  it('writes the metadata block and the text', () => {
    const comment: TaskComment = {
      id: 3,
      taskId: 12,
      created: '20261021024529365',
      updated: '20261021024529365',
      text: 'A comment',
    };

    expect(serializeComment(comment)).toBe(
      [
        'id=3',
        'task=12',
        'created=20261021024529365',
        'updated=20261021024529365',
        '----',
        'A comment',
        '',
      ].join('\n'),
    );
  });

  it('parses back what it serialized', () => {
    const comment = buildComment(4, 5, 'A comment\n\nwith two paragraphs', new Date(2026, 9, 21, 2, 45, 29, 365));
    const parsed = parseComment(serializeComment(comment));

    expect(parsed.id).toBe(4);
    expect(parsed.taskId).toBe(5);
    expect(parsed.created).toBe('20261021024529365');
    expect(parsed.text).toBe('A comment\n\nwith two paragraphs');
  });
});

describe('sortComments', () => {
  it('puts the most recent comment first', () => {
    const comments: TaskComment[] = [
      { id: 1, taskId: 5, created: '20261021000000000', updated: '', text: 'oldest' },
      { id: 2, taskId: 5, created: '20261023000000000', updated: '', text: 'newest' },
      { id: 3, taskId: 5, created: '20261022000000000', updated: '', text: 'middle' },
    ];

    const sorted = sortComments(comments);

    expect(sorted.map((comment) => comment.text)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('breaks the ties with the id', () => {
    const comments: TaskComment[] = [
      { id: 4, taskId: 5, created: '20261021000000000', updated: '', text: 'first' },
      { id: 9, taskId: 5, created: '20261021000000000', updated: '', text: 'second' },
    ];

    expect(sortComments(comments).map((comment) => comment.text)).toEqual(['second', 'first']);
  });
});
