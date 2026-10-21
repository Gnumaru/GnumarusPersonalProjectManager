import { describe, expect, it } from 'vite-plus/test';
import type { BrowserFileStorage } from './browserStorage.js';
import { EmbeddedProjectStore } from './embeddedStore.js';
import { buildTask, type TaskInput } from './task.js';

/** A storage that keeps the files in memory. */
class MemoryStorage implements BrowserFileStorage {
  readonly name = 'memory';
  readonly persistent = true;
  readonly files = new Map<string, string>();

  async read(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async list(): Promise<string[]> {
    return [...this.files.keys()].sort((left, right) => left.localeCompare(right));
  }

  async clear(): Promise<void> {
    this.files.clear();
  }
}

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

async function createStore(): Promise<{ store: EmbeddedProjectStore; storage: MemoryStorage }> {
  const storage = new MemoryStorage();
  const store = new EmbeddedProjectStore(storage);
  await store.load();
  return { store, storage };
}

describe('EmbeddedProjectStore', () => {
  it('creates a task in a file of its own', async () => {
    const { store, storage } = await createStore();

    const id = await store.nextTaskId();
    const task = buildTask(input('The first task'), id, new Date());
    await store.createTaskFile(store.taskPath(id), task);

    expect(storage.files.get('task_1.txt')).toContain('title=The first task');
    expect(await store.nextTaskId()).toBe(2);
  });

  it('lists the tasks with their metadata', async () => {
    const { store } = await createStore();
    const id = await store.nextTaskId();
    await store.createTaskFile(
      store.taskPath(id),
      buildTask(input('A task', 'doing'), id, new Date()),
    );

    const summaries = await store.listTasks();

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.title).toBe('A task');
    expect(summaries[0]?.status).toBe('doing');
    expect(summaries[0]?.path).toBe('task_1.txt');
  });

  it('searches the content of the tasks', async () => {
    const { store } = await createStore();
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
    const { store } = await createStore();
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
    const { store, storage } = await createStore();
    const taskId = await store.nextTaskId();
    await store.createTaskFile(
      store.taskPath(taskId),
      buildTask(input('A task'), taskId, new Date()),
    );

    const comment = await store.createComment(taskId, 'A comment');
    expect(storage.files.get('comment_1.txt')).toContain('task=1');
    expect(storage.files.get('comment_1.txt')).toContain('A comment');

    const comments = await store.listComments(taskId);
    expect(comments).toHaveLength(1);

    await store.writeComment({ ...comment, text: 'The edited comment' });
    const edited = await store.listComments(taskId);
    expect(edited[0]?.text).toBe('The edited comment');

    await store.deleteComment(store.commentPath(comment.id));
    expect(await store.listComments(taskId)).toHaveLength(0);
  });

  it('replaces the whole project when an archive is imported', async () => {
    const { store, storage } = await createStore();
    const id = await store.nextTaskId();
    await store.createTaskFile(
      store.taskPath(id),
      buildTask(input('The old task'), id, new Date()),
    );

    await store.replaceAll([
      { path: 'task_1.txt', content: 'id=1\ntitle=The imported task\n----\nbody\n' },
    ]);

    expect(storage.files.size).toBe(1);
    const summaries = await store.listTasks();
    expect(summaries[0]?.title).toBe('The imported task');
  });

  it('exports the files of the project', async () => {
    const { store } = await createStore();
    const id = await store.nextTaskId();
    await store.createTaskFile(
      store.taskPath(id),
      buildTask(input('A task'), id, new Date()),
    );

    const files = await store.listFiles();

    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('task_1.txt');
    expect(files[0]?.content).toContain('title=A task');
  });
});
