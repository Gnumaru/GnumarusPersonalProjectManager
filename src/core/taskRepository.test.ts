import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { ApiClient } from '../api/client.js';
import { TaskRepository } from './taskRepository.js';

declare const process: { env: Record<string, string | undefined>; cwd(): string };

const token = process.env['GNUMARUS_API_TOKEN'];
const baseUrl = process.env['GNUMARUS_API_URL'] ?? 'http://127.0.0.1:1423';
const testDirectory = `${process.cwd()}/tmp/integration`;

const describeLive = token === undefined || token.length === 0 ? describe.skip : describe;

describeLive('TaskRepository against the live service', () => {
  const api = new ApiClient({ baseUrl, token: token ?? null });
  const repository = new TaskRepository(api);

  beforeAll(async () => {
    await api.execShell({ command: `mkdir -p -- '${testDirectory}'` });
    await api.execShell({
      command: `rm -f -- "${testDirectory}"/task_*.txt "${testDirectory}"/nested/task_*.txt`,
    });
    await api.execShell({ command: `rm -rf -- "${testDirectory}"/nested` });
  });

  afterAll(async () => {
    await api.execShell({
      command: `rm -rf -- '${testDirectory}'`,
    });
  });

  it('creates a task file on disk', async () => {
    const task = await repository.createTask(testDirectory, {
      title: 'Write the integration test',
      description: 'The body of the task',
      status: 'doing',
      tags: ['tests', 'bridge'],
    });

    expect(task.id).toBe(1);
    expect(task.parentId).toBeNull();

    const file = await api.readFile(`${testDirectory}/task_1.txt`);
    expect(file.content).toContain('title=Write the integration test');
    expect(file.content).toContain('status=doing');
    expect(file.content).toContain('tags=tests bridge');
    expect(file.content).toContain('----');
    expect(file.content).toContain('The body of the task');
  });

  it('lists the task files recursively', async () => {
    await repository.createTask(testDirectory, {
      title: 'Second task',
      description: '',
      status: 'todo',
      tags: [],
    });
    await api.execShell({ command: `mkdir -p -- '${testDirectory}/nested'` });
    await api.execShell({
      command: `printf 'id=99\\ntitle=Nested\\n----\\nbody\\n' > '${testDirectory}/nested/task_99.txt'`,
    });

    const paths = await repository.listTaskFilePaths(testDirectory);
    expect(paths.length).toBeGreaterThanOrEqual(3);
    expect(paths.some((path) => path.endsWith('/nested/task_99.txt'))).toBe(true);
  });

  it('returns one page of ten tasks', async () => {
    for (let id = 3; id <= 12; id += 1) {
      await repository.createTask(testDirectory, {
        title: `Filler task ${id}`,
        description: `filler-${id}`,
        status: 'todo',
        tags: ['filler'],
      });
    }

    const page = await repository.getPage(testDirectory, { page: 1, pageSize: 10 });
    expect(page.tasks).toHaveLength(10);
    expect(page.info.totalItems).toBeGreaterThan(10);
    expect(page.info.pageSize).toBe(10);

    const second = await repository.getPage(testDirectory, { page: 2, pageSize: 10 });
    expect(second.tasks).toHaveLength(Math.min(10, page.info.totalItems - 10));
    expect(second.tasks[0]?.id).not.toBe(page.tasks[0]?.id);
  });

  it('searches the tasks with a recursive grep', async () => {
    const found = await repository.searchTaskFilePaths(testDirectory, 'integration');
    expect(found.length).toBe(1);
    expect(found[0]?.endsWith('task_1.txt')).toBe(true);

    const byTag = await repository.searchTaskFilePaths(testDirectory, 'filler-12');
    expect(byTag.length).toBe(1);

    const nothing = await repository.searchTaskFilePaths(testDirectory, 'no-such-content-here');
    expect(nothing).toHaveLength(0);
  });

  it('searches case insensitively', async () => {
    const found = await repository.searchTaskFilePaths(testDirectory, 'INTEGRATION');
    expect(found.length).toBe(1);
  });

  it('updates a task keeping its id', async () => {
    const path = `${testDirectory}/task_1.txt`;
    const updated = await repository.updateTask(path, {
      title: 'Updated title',
      description: 'Updated body',
      status: 'done',
      tags: ['updated'],
    });

    expect(updated.id).toBe(1);
    expect(updated.title).toBe('Updated title');
    expect(updated.status).toBe('done');

    const file = await api.readFile(path);
    expect(file.content).toContain('title=Updated title');
    expect(file.content).toContain('status=done');
    expect(file.content).not.toContain('parent=');
  });

  it('deletes a task file', async () => {
    const path = `${testDirectory}/task_2.txt`;
    await repository.deleteTask(path);
    const exists = await api.fileExists(path);
    expect(exists).toBe(false);
  });

  it('allocates the next free id', async () => {
    const next = await repository.nextTaskId(testDirectory);
    expect(next).toBeGreaterThan(1);
  });
});
