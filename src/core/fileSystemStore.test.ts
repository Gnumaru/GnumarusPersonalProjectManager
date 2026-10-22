import { describe, expect, it } from 'vite-plus/test';
import { FileSystemProjectStore } from './fileSystemStore.js';
import { buildNote } from './note.js';
import { buildTask, type TaskInput } from './task.js';
import { fakeDirectoryHandle } from '../test-support/fakeDirectory.js';

function input(title: string): TaskInput {
  return {
    title,
    description: 'The body',
    status: 'todo',
    tags: ['demo'],
    start: '',
    end: '',
    blockedBy: [],
    related: [],
  };
}

function createStore(): { store: FileSystemProjectStore; handle: FileSystemDirectoryHandle } {
  const handle = fakeDirectoryHandle('project');
  return { store: new FileSystemProjectStore(handle), handle };
}

describe('FileSystemProjectStore', () => {
  it('creates a task in a file of its own', async () => {
    const { store } = createStore();

    const id = await store.nextTaskId();
    await store.createTaskFile(
      store.taskPath(id),
      buildTask(input('The first task'), id, new Date()),
    );

    const paths = await store.listTaskPaths();
    expect(paths).toEqual(['task_1.txt']);

    const task = await store.readTask('task_1.txt');
    expect(task.id).toBe(1);
    expect(task.title).toBe('The first task');
    expect(await store.nextTaskId()).toBe(2);
  });

  it('reads the metadata of every task', async () => {
    const { store } = createStore();
    const id = await store.nextTaskId();
    await store.createTaskFile(
      store.taskPath(id),
      buildTask(input('A task'), id, new Date()),
    );

    const summaries = await store.listTasks();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.title).toBe('A task');
    expect(summaries[0]?.status).toBe('todo');
    expect(summaries[0]?.path).toBe('task_1.txt');
  });

  it('finds the tasks of a subfolder', async () => {
    const { store, handle } = createStore();
    const file = handle as unknown as { addFile: (path: string, content: string) => void };
    file.addFile('nested/task_9.txt', 'id=9\ntitle=Nested\nstatus=todo\n----\nbody\n');

    const paths = await store.listTaskPaths();
    expect(paths).toEqual(['nested/task_9.txt']);
  });

  it('searches the content of the tasks', async () => {
    const { store } = createStore();
    const id = await store.nextTaskId();
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
    const parentId = await store.nextTaskId();
    await store.createTaskFile(
      store.taskPath(parentId),
      buildTask(input('The parent'), parentId, new Date()),
    );
    const childId = await store.nextTaskId();
    await store.createTaskFile(
      store.taskPath(childId),
      buildTask(input('The child'), childId, new Date(), parentId),
    );

    const counts = await store.childCounts();
    expect(counts.get(parentId)).toBe(1);
  });

  it('creates, reads, edits and deletes the comments of a task', async () => {
    const { store } = createStore();
    const taskId = await store.nextTaskId();
    await store.createTaskFile(
      store.taskPath(taskId),
      buildTask(input('A task'), taskId, new Date()),
    );

    const comment = await store.createComment(taskId, 'A comment');
    expect(comment.id).toBe(1);
    expect(comment.taskId).toBe(taskId);

    const comments = await store.listComments(taskId);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.text).toBe('A comment');

    await store.writeComment({ ...comment, text: 'The edited comment' });
    const edited = await store.listComments(taskId);
    expect(edited[0]?.text).toBe('The edited comment');

    await store.deleteComment(store.commentPath(comment.id));
    expect(await store.listComments(taskId)).toHaveLength(0);
  });

  it('creates a note, with its id inside the file', async () => {
    const { store } = createStore();

    const id = await store.nextNoteId();
    await store.createNoteFile(
      store.notePath(id),
      buildNote({ title: 'A note', content: '# Hello' }, id, new Date()),
    );

    expect(await store.listNotePaths()).toEqual(['note_1.txt']);

    const note = await store.readNote('note_1.txt');
    expect(note.id).toBe(1);
    expect(note.title).toBe('A note');
    expect(note.content).toBe('# Hello');
    expect(await store.nextNoteId()).toBe(2);
  });

  it('searches the notes by title, by content or by both', async () => {
    const { store } = createStore();
    const id = await store.nextNoteId();
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
    const id = await store.nextNoteId();
    const note = buildNote({ title: 'A note', content: 'body' }, id, new Date());
    await store.createNoteFile(store.notePath(id), note);

    await store.writeNote(store.notePath(id), { ...note, title: 'The edited note' });
    const reloaded = await store.readNote(store.notePath(id));
    expect(reloaded.title).toBe('The edited note');

    await store.deleteFile(store.notePath(id));
    expect(await store.listNotePaths()).toHaveLength(0);
  });

  it('refuses to create a file that already exists', async () => {
    const { store } = createStore();
    const id = await store.nextTaskId();
    const task = buildTask(input('A task'), id, new Date());
    await store.createTaskFile(store.taskPath(id), task);

    await expect(store.createTaskFile(store.taskPath(id), task)).rejects.toThrow(/already exists/u);
  });

  it('exports the files of the project and imports them back', async () => {
    const { store } = createStore();
    const id = await store.nextTaskId();
    await store.createTaskFile(
      store.taskPath(id),
      buildTask(input('A task'), id, new Date()),
    );

    const files = await store.listFiles();
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('task_1.txt');
    expect(files[0]?.content).toContain('title=A task');

    await store.replaceAll([
      { path: 'note_1.txt', content: 'id=1\ntitle=An imported note\n----\nbody\n' },
    ]);

    expect(await store.listTaskPaths()).toHaveLength(0);
    const notes = await store.listNotePaths();
    expect(notes).toEqual(['note_1.txt']);
  });

  it('keeps the notes and the tasks apart', async () => {
    const { store } = createStore();
    const taskId = await store.nextTaskId();
    await store.createTaskFile(
      store.taskPath(taskId),
      buildTask(input('A task'), taskId, new Date()),
    );
    const noteId = await store.nextNoteId();
    await store.createNoteFile(
      store.notePath(noteId),
      buildNote({ title: 'A note', content: 'body' }, noteId, new Date()),
    );

    expect(await store.listTaskPaths()).toEqual(['task_1.txt']);
    expect(await store.listNotePaths()).toEqual(['note_1.txt']);
  });
});
