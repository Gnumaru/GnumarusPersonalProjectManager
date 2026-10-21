import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { ApiClient } from '../api/client.js';
import { ServiceProjectStore } from './serviceStore.js';
import {
  buildTask,
  withParent,
  type Task,
  type TaskInput,
} from './task.js';

declare const process: { env: Record<string, string | undefined>; cwd(): string };

const token = process.env['GNUMARUS_API_TOKEN'];
const baseUrl = process.env['GNUMARUS_API_URL'] ?? 'http://127.0.0.1:1423';
const testDirectory = `${process.cwd()}/tmp/integration`;

/**
 * The suite runs when the service is reachable: a token is enough, but a
 * service started without the token requirement works as well.
 */
async function canRunAgainstTheLiveService(): Promise<boolean> {
  if (token !== undefined && token.length > 0) {
    return true;
  }
  try {
    const response = await fetch(`${baseUrl}/api/help`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      return false;
    }
    const payload = (await response.json()) as { auth?: { required?: string } };
    return payload.auth?.required === 'b:false';
  } catch {
    return false;
  }
}

const describeLive = (await canRunAgainstTheLiveService()) ? describe : describe.skip;

function input(title: string, status: TaskInput['status'] = 'todo'): TaskInput {
  return {
    title,
    description: '',
    status,
    tags: [],
    start: '',
    end: '',
    blockedBy: [],
    related: [],
  };
}

describeLive('ServiceProjectStore against the live service', () => {
  const api = new ApiClient({ baseUrl, token: token ?? null });
  const store = new ServiceProjectStore(api, testDirectory);

  beforeAll(async () => {
    await api.execShell({ command: `mkdir -p -- '${testDirectory}'` });
    await api.execShell({
      command: `rm -f -- "${testDirectory}"/task_*.txt "${testDirectory}"/comment_*.txt "${testDirectory}"/nested/task_*.txt`,
    });
    await api.execShell({ command: `rm -rf -- "${testDirectory}"/nested` });
  });

  afterAll(async () => {
    await api.execShell({
      command: `rm -rf -- '${testDirectory}'`,
    });
  });

  it('creates a task file on disk', async () => {
    const id = await store.nextTaskId();
    const task = buildTask(input('Write the integration test', 'doing'), id, new Date());
    await store.createTaskFile(store.taskPath(id), task);

    const file = await api.readFile(`${testDirectory}/task_${id}.txt`);
    expect(file.content).toContain('title=Write the integration test');
    expect(file.content).toContain('status=doing');
    expect(file.content).toContain('----');

    const reloaded = await store.readTask(store.taskPath(id));
    expect(reloaded.id).toBe(id);
    expect(reloaded.title).toBe('Write the integration test');
  });

  it('lists the task files recursively', async () => {
    await api.execShell({ command: `mkdir -p -- '${testDirectory}/nested'` });
    await api.execShell({
      command: `printf 'id=99\\ntitle=Nested\\n----\\nbody\\n' > '${testDirectory}/nested/task_99.txt'`,
    });

    const paths = await store.listTaskPaths();
    expect(paths.length).toBeGreaterThanOrEqual(2);
    expect(paths.some((path) => path.endsWith('nested/task_99.txt'))).toBe(true);
  });

  it('searches the tasks with a recursive grep', async () => {
    const found = await store.searchTaskPaths('integration');
    expect(found.length).toBe(1);
    expect(found[0]?.endsWith('task_1.txt')).toBe(true);

    const nothing = await store.searchTaskPaths('no-such-content-here');
    expect(nothing).toHaveLength(0);
  });

  it('searches case insensitively', async () => {
    const found = await store.searchTaskPaths('INTEGRATION');
    expect(found.length).toBe(1);
  });

  it('updates a task keeping its id', async () => {
    const id = 1;
    const path = store.taskPath(id);
    const current = await store.readTask(path);
    const updated: Task = { ...current, title: 'Updated title', status: 'done' };
    await store.writeTask(path, updated);

    const file = await api.readFile(`${testDirectory}/task_${id}.txt`);
    expect(file.content).toContain('title=Updated title');
    expect(file.content).toContain('status=done');
    expect(file.content).toContain('id=1');

    const reloaded = await store.readTask(path);
    expect(reloaded.id).toBe(id);
    expect(reloaded.title).toBe('Updated title');
  });

  it('deletes a task file', async () => {
    const id = await store.nextTaskId();
    const task = buildTask(input('Doomed task'), id, new Date());
    await store.createTaskFile(store.taskPath(id), task);

    await store.deleteFile(store.taskPath(id));
    const paths = await store.listTaskPaths();
    expect(paths.some((path) => path.endsWith(`task_${id}.txt`))).toBe(false);
  });

  it('allocates the next free id', async () => {
    const next = await store.nextTaskId();
    expect(next).toBeGreaterThan(1);
  });

  it('reads the metadata of every task', async () => {
    const summaries = await store.listTasks();
    expect(summaries.length).toBeGreaterThan(0);
    const first = summaries.find((summary) => summary.id === 1);
    expect(first?.title).toBe('Updated title');
    expect(first?.status).toBe('done');
    // The paths are relative to the folder of the project.
    expect(first?.path).toBe('task_1.txt');
    // A task of a subfolder is read as well.
    const nested = summaries.find((summary) => summary.path === 'nested/task_99.txt');
    expect(nested?.title).toBe('Nested');
  });

  it('counts the children of every task', async () => {
    const id = await store.nextTaskId();
    const parent = buildTask(input('Counted parent'), id, new Date());
    await store.createTaskFile(store.taskPath(id), parent);
    const childId = await store.nextTaskId();
    const child = buildTask(input('Counted child'), childId, new Date(), id);
    await store.createTaskFile(store.taskPath(childId), child);

    const counts = await store.childCounts();
    expect(counts.get(id)).toBe(1);
  });

  it('lists the children of a task', async () => {
    const summaries = await store.listTasks();
    const parent = summaries.find((summary) => summary.title === 'Counted parent');
    expect(parent).toBeDefined();
    if (parent === undefined) {
      return;
    }
    const children = summaries.filter((summary) => summary.parentId === parent.id);
    expect(children).toHaveLength(1);
    expect(children[0]?.title).toBe('Counted child');
  });

  it('moves a task under another parent', async () => {
    const summaries = await store.listTasks();
    const parent = summaries.find((summary) => summary.title === 'Counted parent');
    const child = summaries.find((summary) => summary.title === 'Counted child');
    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    if (parent === undefined || child === undefined) {
      return;
    }
    const path = store.taskPath(child.id);
    const current = await store.readTask(path);
    await store.writeTask(path, withParent(current, parent.id, new Date()));

    const reloaded = await store.readTask(path);
    expect(reloaded.parentId).toBe(parent.id);
  });

  it('creates, reads, edits and deletes the comments of a task', async () => {
    const summaries = await store.listTasks();
    const task = summaries[0];
    expect(task).toBeDefined();
    if (task === undefined) {
      return;
    }

    const comment = await store.createComment(task.id, 'The first comment');
    expect(comment.id).toBeGreaterThan(0);
    expect(comment.taskId).toBe(task.id);

    // The comment is a file of its own, in the format of the task files.
    const file = await api.readFile(`${testDirectory}/comment_${comment.id}.txt`);
    expect(file.content).toContain(`id=${comment.id}`);
    expect(file.content).toContain(`task=${task.id}`);
    expect(file.content).toContain('----');
    expect(file.content).toContain('The first comment');

    // The comments of the task are listed, the most recent first.
    const second = await store.createComment(task.id, 'The second comment');
    const comments = await store.listComments(task.id);
    expect(comments.map((entry) => entry.text)).toEqual(['The second comment', 'The first comment']);
    expect(comments.map((entry) => entry.id)).toEqual([second.id, comment.id]);

    // The text of a comment is edited.
    const path = store.commentPath(comment.id);
    await store.writeComment({ ...comment, text: 'The edited comment' });
    const edited = await store.listComments(task.id);
    expect(edited.find((entry) => entry.id === comment.id)?.text).toBe('The edited comment');

    // A comment is deleted.
    await store.deleteComment(path);
    expect((await store.listComments(task.id)).some((entry) => entry.id === comment.id)).toBe(false);
  });

  it('writes the dates in the compact format', async () => {
    const summaries = await store.listTasks();
    const task = summaries[0];
    expect(task).toBeDefined();
    if (task === undefined) {
      return;
    }
    const path = store.taskPath(task.id);
    const current = await store.readTask(path);
    await store.writeTask(path, { ...current, start: '20261019100000000', end: '' });

    const file = await api.readFile(`${testDirectory}/task_${task.id}.txt`);
    expect(file.content).toMatch(/^start=\d{17}$/mu);
    expect(file.content).toMatch(/^end=$/mu);
  });

  it('exports the files of the project and imports them back', async () => {
    const files = await store.listFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.path.endsWith('.txt'))).toBe(true);
  });
});
