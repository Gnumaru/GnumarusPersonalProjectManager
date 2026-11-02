import { describe, expect, it } from 'vite-plus/test';
import { SupabaseClient } from '../api/supabase.js';
import { FakePostgrest } from '../test-support/fakePostgrest.js';
import { MAX_ID, MIN_ID, isValidRecordId } from './ids.js';
import { buildNote } from './note.js';
import { databaseTimestampValue, parseDatabaseTimestamp, SupabaseProjectStore } from './supabaseStore.js';
import { buildTask, type TaskInput } from './task.js';

const URL = 'https://xyz.supabase.co';
const KEY = 'test-key';

function input(title: string, status: TaskInput['status'] = 'todo'): TaskInput {
  return {
    title,
    description: 'The body',
    status,
    tags: ['demo'],
    start: '',
    end: '',
    blockedBy: [],
    related: [],
  };
}

function createStore(
  backend: FakePostgrest = new FakePostgrest({ key: KEY }),
): { store: SupabaseProjectStore; backend: FakePostgrest } {
  const client = new SupabaseClient({ url: URL, key: KEY, fetchImpl: backend.fetch });
  return { store: new SupabaseProjectStore(client), backend };
}

describe('SupabaseProjectStore', () => {
  it('converts timestamps between the compact format and the database', () => {
    expect(parseDatabaseTimestamp('2026-10-24 10:00:00')).toBe('20261024100000000');
    expect(parseDatabaseTimestamp('2026-10-24 10:00:00.123')).toBe('20261024100000123');
    expect(parseDatabaseTimestamp('2026-10-24 10:00:00.123456')).toBe('20261024100000123');
    expect(parseDatabaseTimestamp('20261024100000000')).toBe('20261024100000000');
    expect(parseDatabaseTimestamp('')).toBe('');
    expect(parseDatabaseTimestamp(null)).toBe('');
    expect(parseDatabaseTimestamp(42)).toBe('');
    expect(databaseTimestampValue('')).toBeNull();
    expect(databaseTimestampValue('20261024100000123')).toBe('2026-10-24 10:00:00.123');
  });

  it('stores unknown dates as null and reads them back empty', async () => {
    const { store, backend } = createStore();
    const id = await store.allocateId();
    await store.createTaskFile(
      store.taskPath(id),
      { ...buildTask(input('Dateless task'), id, new Date()), start: '', end: '' },
    );

    expect(backend.tables.tasks.get(String(id))?.['start']).toBeNull();
    expect(backend.tables.tasks.get(String(id))?.['end']).toBeNull();
    const reloaded = await store.readTask(store.taskPath(id));
    expect(reloaded.start).toBe('');
    expect(reloaded.end).toBe('');
    expect(reloaded.created).toMatch(/^\d{17}$/u);
  });

  it('creates a task in a row of its own', async () => {
    const { store, backend } = createStore();

    const id = await store.allocateId();
    expect(isValidRecordId(id)).toBe(true);
    const task = buildTask(input('The first task'), id, new Date());
    await store.createTaskFile(store.taskPath(id), task);

    expect(backend.tables.tasks.get(String(id))?.['title']).toBe('The first task');
    expect(backend.tables.tasks.get(String(id))?.['description']).toBe('The body');
  });

  it('allocates nonzero ids that never repeat, whatever the kind of record', async () => {
    const { store } = createStore();

    const taskId = await store.allocateId();
    await store.createTaskFile(
      store.taskPath(taskId),
      buildTask(input('A task'), taskId, new Date()),
    );
    const noteId = await store.allocateId();
    const comment = await store.createComment(taskId, 'A comment');

    for (const allocated of [taskId, noteId, comment.id]) {
      expect(isValidRecordId(allocated)).toBe(true);
    }
    expect(new Set([taskId, noteId, comment.id]).size).toBe(3);

    // Deleted ids stay registered: removing the task must not free its id.
    await store.deleteFile(store.taskPath(taskId));
    const later = await store.allocateId();
    expect(later).not.toBe(taskId);
    expect(isValidRecordId(later)).toBe(true);
  });

  it('bootstraps the registry from the rows already stored', async () => {
    const backend = new FakePostgrest({ key: KEY });
    backend.addRow('tasks', { id: 7, title: 'Legacy' });
    backend.addRow('notes', { id: 9, title: 'Legacy note' });
    const { store } = createStore(backend);

    const id = await store.allocateId();
    expect(id).not.toBe(7);
    expect(id).not.toBe(9);
    expect(backend.tables.ids.has('7')).toBe(true);
    expect(backend.tables.ids.has('9')).toBe(true);
  });

  it('lists the tasks with their metadata', async () => {
    const { store } = createStore();
    const id = await store.allocateId();
    await store.createTaskFile(
      store.taskPath(id),
      buildTask(input('A task', 'doing'), id, new Date()),
    );

    const summaries = await store.listTasks();

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.title).toBe('A task');
    expect(summaries[0]?.status).toBe('doing');
    expect(summaries[0]?.path).toBe(store.taskPath(id));
  });

  it('lists task and note paths in numeric id order, across the whole range', async () => {
    const { store } = createStore();
    const taskIds = [10, -2, MAX_ID, MIN_ID, 2, -10];
    for (const id of taskIds) {
      await store.createTaskFile(
        store.taskPath(id),
        buildTask(input(`Task ${id}`), id, new Date()),
      );
    }
    const expectedTasks = [MIN_ID, -10, -2, 2, 10, MAX_ID].map((id) => store.taskPath(id));
    expect(await store.listTaskPaths()).toEqual(expectedTasks);
    expect(await store.searchTaskPaths('')).toEqual(expectedTasks);

    const noteIds = [3, MIN_ID, -1, MAX_ID];
    for (const id of noteIds) {
      await store.createNoteFile(
        store.notePath(id),
        buildNote({ title: `Note ${id}`, content: '' }, id, new Date()),
      );
    }
    const expectedNotes = [MIN_ID, -1, 3, MAX_ID].map((id) => store.notePath(id));
    expect(await store.listNotePaths()).toEqual(expectedNotes);
    expect(await store.searchNotePaths('', 'both')).toEqual(expectedNotes);
  });

  it('reads rows with missing values like the equivalent files', async () => {
    const backend = new FakePostgrest({ key: KEY });
    backend.addRow('tasks', { id: 5, title: 'Sparse' });
    const { store } = createStore(backend);

    const summaries = await store.listTasks();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.status).toBe('todo');
    expect(summaries[0]?.type).toBe('Feature');
    expect(summaries[0]?.role).toBe('Programming');
    expect(summaries[0]?.tags).toEqual([]);
    expect(summaries[0]?.kanbanOrder).toBe(0);
  });

  it('round trips a task through rows and files without losing anything', async () => {
    const { store } = createStore();
    const id = await store.allocateId();
    const task = {
      ...buildTask(
        {
          ...input('Round trip'),
          tags: ['frontend', 'ui'],
          blockedBy: [11, 13],
          related: [17],
          type: 'Bug' as const,
          role: 'Design' as const,
        },
        id,
        new Date(),
      ),
      description: 'First line\n\nSecond paragraph',
    };
    await store.createTaskFile(store.taskPath(id), task);

    const files = await store.listFiles();
    const file = files.find((entry) => entry.path === store.taskPath(id));
    expect(file?.content).toContain('title=Round trip');
    expect(file?.content).toContain('tags=frontend ui');
    expect(file?.content).toContain('blocked_by=11,13');
    expect(file?.content).toContain('related=17');
    expect(file?.content).toContain('type=Bug');
    expect(file?.content).toContain('First line');
  });

  it('searches the content of the tasks', async () => {
    const { store } = createStore();
    const id = await store.allocateId();
    await store.createTaskFile(
      store.taskPath(id),
      buildTask({ ...input('A task'), description: 'A needle in the haystack' }, id, new Date()),
    );

    expect(await store.searchTaskPaths('needle')).toHaveLength(1);
    expect(await store.searchTaskPaths('NEEDLE')).toHaveLength(1);
    expect(await store.searchTaskPaths('nothing here')).toHaveLength(0);
  });

  it('counts the children of every task', async () => {
    const { store } = createStore();
    const parentId = await store.allocateId();
    await store.createTaskFile(
      store.taskPath(parentId),
      buildTask(input('The parent'), parentId, new Date()),
    );
    const childId = await store.allocateId();
    await store.createTaskFile(
      store.taskPath(childId),
      buildTask(input('The child'), childId, new Date(), parentId),
    );

    const counts = await store.childCounts();
    expect(counts.get(parentId)).toBe(1);
  });

  it('creates, reads, edits and deletes the comments of a task', async () => {
    const { store, backend } = createStore();
    const taskId = await store.allocateId();
    await store.createTaskFile(
      store.taskPath(taskId),
      buildTask(input('A task'), taskId, new Date()),
    );

    const comment = await store.createComment(taskId, 'A comment');
    expect(backend.tables.comments.get(String(comment.id))?.['task']).toBe(taskId);
    expect(backend.tables.comments.get(String(comment.id))?.['body']).toBe('A comment');

    const comments = await store.listComments(taskId);
    expect(comments).toHaveLength(1);

    await store.writeComment({ ...comment, text: 'The edited comment' });
    const edited = await store.listComments(taskId);
    expect(edited[0]?.text).toBe('The edited comment');

    await store.deleteComment(store.commentPath(comment.id));
    expect(await store.listComments(taskId)).toHaveLength(0);
  });

  it('replaces the whole project when an archive is imported', async () => {
    const { store, backend } = createStore();
    const id = await store.allocateId();
    await store.createTaskFile(
      store.taskPath(id),
      buildTask(input('The old task'), id, new Date()),
    );

    await store.replaceAll([
      { path: 'task_1.txt', content: 'id=1\ntitle=The imported task\n----\nbody\n' },
    ]);

    // The import replaces the whole project: only the imported records and
    // their ids are registered.
    expect(backend.tables.tasks.has(String(id))).toBe(false);
    expect([...backend.tables.ids.keys()].sort()).toEqual(['1']);
    const summaries = await store.listTasks();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.title).toBe('The imported task');
  });

  it('exports the files of the project', async () => {
    const { store } = createStore();
    const id = await store.allocateId();
    await store.createTaskFile(
      store.taskPath(id),
      buildTask(input('A task'), id, new Date()),
    );

    const files = await store.listFiles();

    // The task file plus the ids.txt registry.
    expect(files.map((file) => file.path).sort()).toEqual([store.taskPath(id), 'ids.txt'].sort());
    expect(files.find((file) => file.path === store.taskPath(id))?.content).toContain('title=A task');
  });

  it('creates a note in a row of its own, with its id inside the file', async () => {
    const { store, backend } = createStore();

    const id = await store.allocateId();
    const note = buildNote({ title: 'The first note', content: '# Hello' }, id, new Date());
    await store.createNoteFile(store.notePath(id), note);

    expect(backend.tables.notes.get(String(id))?.['title']).toBe('The first note');
    expect(backend.tables.notes.get(String(id))?.['body']).toBe('# Hello');
  });

  it('lists and reads the notes', async () => {
    const { store } = createStore();
    const id = await store.allocateId();
    await store.createNoteFile(
      store.notePath(id),
      buildNote({ title: 'A note', content: 'The body' }, id, new Date()),
    );

    expect(await store.listNotePaths()).toEqual([store.notePath(id)]);

    const note = await store.readNote(store.notePath(id));
    expect(note.id).toBe(id);
    expect(note.title).toBe('A note');
    expect(note.content).toBe('The body');
  });

  it('searches the notes by title, by content or by both', async () => {
    const { store } = createStore();
    const id = await store.allocateId();
    await store.createNoteFile(
      store.notePath(id),
      buildNote({ title: 'Shopping list', content: 'Remember the milk' }, id, new Date()),
    );

    expect(await store.searchNotePaths('shopping', 'title')).toHaveLength(1);
    expect(await store.searchNotePaths('milk', 'title')).toHaveLength(0);
    expect(await store.searchNotePaths('milk', 'content')).toHaveLength(1);
    expect(await store.searchNotePaths('shopping', 'content')).toHaveLength(0);
    expect(await store.searchNotePaths('milk', 'both')).toHaveLength(1);
  });

  it('edits and deletes a note', async () => {
    const { store } = createStore();
    const id = await store.allocateId();
    const note = buildNote({ title: 'A note', content: 'body' }, id, new Date());
    await store.createNoteFile(store.notePath(id), note);

    await store.writeNote(store.notePath(id), { ...note, title: 'The edited note' });
    const reloaded = await store.readNote(store.notePath(id));
    expect(reloaded.title).toBe('The edited note');

    await store.deleteFile(store.notePath(id));
    expect(await store.listNotePaths()).toHaveLength(0);
  });

  it('keeps the notes and the tasks apart', async () => {
    const { store } = createStore();
    const taskId = await store.allocateId();
    await store.createTaskFile(
      store.taskPath(taskId),
      buildTask(input('A task'), taskId, new Date()),
    );
    const noteId = await store.allocateId();
    await store.createNoteFile(
      store.notePath(noteId),
      buildNote({ title: 'A note', content: 'body' }, noteId, new Date()),
    );

    expect(await store.listTaskPaths()).toEqual([store.taskPath(taskId)]);
    expect(await store.listNotePaths()).toEqual([store.notePath(noteId)]);
  });

  it('reads and writes the application config rows', async () => {
    const { store, backend } = createStore();

    expect(await store.readAppConfig()).toBeNull();
    await store.writeAppConfig('kanban_show_hidden_todo=true\nview=kanban\n');
    expect(await store.readAppConfig()).toBe('kanban_show_hidden_todo=true\nview=kanban\n');
    expect(backend.tables.config.get('view')).toEqual({ key: 'view', value: 'kanban' });

    await store.writeAppConfig('');
    expect(await store.readAppConfig()).toBeNull();
  });
});
