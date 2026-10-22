import { describe, expect, it } from 'vite-plus/test';
import {
  applyNoteInput,
  buildNote,
  isNoteFileName,
  noteFileName,
  noteMatches,
  notePreview,
  parseNote,
  parseNoteIdFromFileName,
  serializeNote,
  type Note,
} from './note.js';

describe('the note file names', () => {
  it('builds the name out of the id', () => {
    expect(noteFileName(7)).toBe('note_7.txt');
  });

  it('recognizes the names', () => {
    expect(isNoteFileName('note_7.txt')).toBe(true);
    expect(isNoteFileName('task_7.txt')).toBe(false);
    expect(isNoteFileName('comment_7.txt')).toBe(false);
    expect(isNoteFileName('note_.txt')).toBe(false);
  });

  it('extracts the id from the name', () => {
    expect(parseNoteIdFromFileName('note_12.txt')).toBe(12);
    expect(parseNoteIdFromFileName('note_x.txt')).toBeNull();
  });
});

describe('parseNote', () => {
  it('reads the metadata and the body', () => {
    const content = [
      'id=3',
      'title=Shopping list',
      'created=20261021024529365',
      'updated=20261022000000000',
      '----',
      '# Shopping',
      '',
      '- milk',
    ].join('\n');

    const note = parseNote(content);

    expect(note.id).toBe(3);
    expect(note.title).toBe('Shopping list');
    expect(note.created).toBe('20261021024529365');
    expect(note.updated).toBe('20261022000000000');
    expect(note.content).toBe('# Shopping\n\n- milk');
  });

  it('keeps the id of the file when the file has no id key', () => {
    const content = ['title=No id', '----', 'Body'].join('\n');
    expect(parseNote(content, 42).id).toBe(42);
  });

  it('reads a note without a body', () => {
    const note = parseNote(['id=1', 'title=Empty', '----'].join('\n'));
    expect(note.content).toBe('');
  });
});

describe('serializeNote', () => {
  it('writes the id inside the file', () => {
    const note: Note = {
      id: 9,
      title: 'A note',
      created: '20261021024529365',
      updated: '20261022000000000',
      content: 'The body',
    };

    const content = serializeNote(note);

    expect(content).toContain('id=9');
    expect(content).toContain('title=A note');
    expect(content).toContain('----');
    expect(content.endsWith('The body\n')).toBe(true);
  });

  it('keeps a title that holds a line break on one line', () => {
    const note: Note = {
      id: 9,
      title: 'First line\nSecond line',
      created: '',
      updated: '',
      content: '',
    };
    expect(serializeNote(note)).toContain('title=First line Second line');
  });

  it('round trips', () => {
    const note: Note = {
      id: 4,
      title: 'Round trip',
      created: '20261021024529365',
      updated: '20261022000000000',
      content: '# Title\n\nSome **bold** text.',
    };
    const parsed = parseNote(serializeNote(note));
    expect(parsed).toEqual(note);
  });
});

describe('buildNote', () => {
  it('stamps the creation and the update time', () => {
    const note = buildNote({ title: '  A note  ', content: 'Body' }, 5, new Date(2026, 9, 22, 10, 0, 0));
    expect(note.id).toBe(5);
    expect(note.title).toBe('A note');
    expect(note.created).toBe('20261022100000000');
    expect(note.updated).toBe('20261022100000000');
  });
});

describe('applyNoteInput', () => {
  it('keeps the id and the creation time', () => {
    const note: Note = {
      id: 4,
      title: 'Old title',
      created: '20261021024529365',
      updated: '20261022000000000',
      content: 'Old body',
    };

    const updated = applyNoteInput(
      note,
      { title: 'New title', content: 'New body' },
      new Date(2026, 9, 22, 11, 30, 0),
    );

    expect(updated.id).toBe(4);
    expect(updated.created).toBe('20261021024529365');
    expect(updated.title).toBe('New title');
    expect(updated.content).toBe('New body');
    expect(updated.updated).toBe('20261022113000000');
  });
});

describe('noteMatches', () => {
  const note: Note = {
    id: 1,
    title: 'Shopping list',
    created: '',
    updated: '',
    content: 'Remember the milk and the eggs.',
  };

  it('looks at the title and the content', () => {
    expect(noteMatches(note, 'shopping', 'both')).toBe(true);
    expect(noteMatches(note, 'milk', 'both')).toBe(true);
    expect(noteMatches(note, 'bread', 'both')).toBe(false);
  });

  it('looks at the title only', () => {
    expect(noteMatches(note, 'shopping', 'title')).toBe(true);
    expect(noteMatches(note, 'milk', 'title')).toBe(false);
  });

  it('looks at the content only', () => {
    expect(noteMatches(note, 'milk', 'content')).toBe(true);
    expect(noteMatches(note, 'shopping', 'content')).toBe(false);
  });

  it('ignores the case', () => {
    expect(noteMatches(note, 'SHOPPING', 'title')).toBe(true);
  });

  it('matches everything with an empty term', () => {
    expect(noteMatches(note, '', 'title')).toBe(true);
    expect(noteMatches(note, '   ', 'content')).toBe(true);
  });
});

describe('notePreview', () => {
  it('removes the markdown marks', () => {
    const preview = notePreview('# Title\n\n- **milk** and [eggs](https://example.org)');
    expect(preview).toBe('Title milk and eggs');
  });

  it('shortens a long text', () => {
    const preview = notePreview('a'.repeat(200), 20);
    expect(preview).toHaveLength(20);
    expect(preview.endsWith('…')).toBe(true);
  });
});
