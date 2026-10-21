import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { ApiClient, parseServiceInfo } from '../api/client.js';
import { TaskRepository } from './taskRepository.js';

declare const process: { env: Record<string, string | undefined>; cwd(): string };

const token = process.env['GNUMARUS_API_TOKEN'];
const baseUrl = process.env['GNUMARUS_API_URL'] ?? 'http://127.0.0.1:1423';
const testDirectory = `${process.cwd()}/tmp/integration`;

/**
 * The integration suite runs when the service is reachable.
 *
 * A token is enough, but a service started **without** the token requirement
 * works as well: the policy published by `/api/help` tells which case it is.
 */
async function canRunAgainstTheLiveService(): Promise<boolean> {
  if (token !== undefined && token.length > 0) {
    return true;
  }
  try {
    const response = await fetch(`${baseUrl}/api/help`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return false;
    }
    const payload: unknown = await response.json();
    return parseServiceInfo(payload).authRequired === false;
  } catch {
    return false;
  }
}

const describeLive = (await canRunAgainstTheLiveService()) ? describe : describe.skip;

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
      start: '',
      end: '',
      blockedBy: [],
      related: [],
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
      start: '',
      end: '',
      blockedBy: [],
      related: [],
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
        start: '',
        end: '',
        blockedBy: [],
        related: [],
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
      start: '',
      end: '',
      blockedBy: [],
      related: [],
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

  it('creates a child task that points to its parent', async () => {
    const parent = await repository.createTask(testDirectory, {
      title: 'The parent',
      description: '',
      status: 'todo',
      tags: [],
      start: '',
      end: '',
      blockedBy: [],
      related: [],
    });

    const child = await repository.createTask(
      testDirectory,
      {
        title: 'The child',
        description: 'The body of the child',
        status: 'doing',
        tags: ['child'],
        start: '',
        end: '',
        blockedBy: [],
        related: [],
      },
      parent.id,
    );

    expect(child.parentId).toBe(parent.id);

    const file = await api.readFile(`${testDirectory}/task_${child.id}.txt`);
    expect(file.content).toContain(`parent=${parent.id}`);
    expect(file.content).toContain('title=The child');

    const reloaded = await repository.loadTask(`${testDirectory}/task_${child.id}.txt`);
    expect(reloaded.parentId).toBe(parent.id);
  });

  it('refuses to create a child of a task that does not exist', async () => {
    await expect(
      repository.createTask(
        testDirectory,
        { title: 'Orphan', description: '', status: 'todo', tags: [], start: '', end: '', blockedBy: [], related: [] },
        9999,
      ),
    ).rejects.toThrow('does not exist');
  });

  it('counts the children of every task', async () => {
    const parent = await repository.createTask(testDirectory, {
      title: 'Counted parent',
      description: '',
      status: 'todo',
      tags: [],
      start: '',
      end: '',
      blockedBy: [],
      related: [],
    });
    await repository.createTask(
      testDirectory,
      { title: 'Counted child', description: '', status: 'todo', tags: [], start: '', end: '', blockedBy: [], related: [] },
      parent.id,
    );

    const counts = await repository.childCounts(testDirectory);
    expect(counts.get(parent.id)).toBe(1);
  });

  it('lists the children of a task', async () => {
    const parent = await repository.createTask(testDirectory, {
      title: 'Father',
      description: '',
      status: 'todo',
      tags: [],
      start: '',
      end: '',
      blockedBy: [],
      related: [],
    });
    const first = await repository.createTask(
      testDirectory,
      { title: 'Son', description: '', status: 'todo', tags: [], start: '', end: '', blockedBy: [], related: [] },
      parent.id,
    );
    const second = await repository.createTask(
      testDirectory,
      { title: 'Daughter', description: '', status: 'todo', tags: [], start: '', end: '', blockedBy: [], related: [] },
      parent.id,
    );

    const children = await repository.findChildren(testDirectory, parent.id);
    const ids = children.map((child) => child.id);
    expect(ids).toContain(first.id);
    expect(ids).toContain(second.id);
    expect(children.every((child) => child.parentId === parent.id)).toBe(true);
  });

  it('writes the dates in the compact format', async () => {
    const task = await repository.createTask(testDirectory, {
      title: 'Dated task',
      description: '',
      status: 'todo',
      tags: [],
      start: '',
      end: '',
      blockedBy: [],
      related: [],
    });

    const file = await api.readFile(repository.taskPath(testDirectory, task.id));

    expect(file.content).toMatch(/^created=\d{17}$/mu);
    expect(file.content).toMatch(/^updated=\d{17}$/mu);
    expect(file.content).toMatch(/^start=$/mu);
    expect(file.content).toMatch(/^end=$/mu);
    expect(file.content).not.toContain('T');
  });

  it('creates, reads, edits and deletes the comments of a task', async () => {
    const task = await repository.createTask(testDirectory, {
      title: 'Commented task',
      description: '',
      status: 'todo',
      tags: [],
      start: '',
      end: '',
      blockedBy: [],
      related: [],
    });

    const comment = await repository.createComment(testDirectory, task.id, 'The first comment');
    expect(comment.id).toBeGreaterThan(0);
    expect(comment.taskId).toBe(task.id);
    expect(comment.text).toBe('The first comment');

    // The comment is a file of its own, in the format of the task files.
    const path = `${testDirectory}/comment_${comment.id}.txt`;
    const file = await api.readFile(path);
    expect(file.content).toContain(`id=${comment.id}`);
    expect(file.content).toContain(`task=${task.id}`);
    expect(file.content).toContain('----');
    expect(file.content).toContain('The first comment');

    // The comments of the task are listed, the most recent first.
    const second = await repository.createComment(testDirectory, task.id, 'The second comment');
    const comments = await repository.listComments(testDirectory, task.id);
    expect(comments.map((entry) => entry.text)).toEqual(['The second comment', 'The first comment']);
    expect(comments.map((entry) => entry.id)).toEqual([second.id, comment.id]);

    // The comments of the other tasks are not listed.
    const other = await repository.createTask(testDirectory, {
      title: 'Other task',
      description: '',
      status: 'todo',
      tags: [],
      start: '',
      end: '',
      blockedBy: [],
      related: [],
    });
    expect(await repository.listComments(testDirectory, other.id)).toHaveLength(0);

    // The text of a comment is edited.
    await repository.updateComment(path, 'The edited comment');
    const edited = await repository.loadComment(path);
    expect(edited.text).toBe('The edited comment');
    expect(edited.id).toBe(comment.id);

    // A comment is deleted.
    await repository.deleteComment(path);
    expect(await repository.listComments(testDirectory, task.id)).toHaveLength(1);
  });

  it('reads the hierarchy of the tasks', async () => {
    const root = await repository.createTask(testDirectory, {
      title: 'Hierarchy root',
      description: '',
      status: 'todo',
      tags: [],
      start: '',
      end: '',
      blockedBy: [],
      related: [],
    });
    const child = await repository.createTask(
      testDirectory,
      { title: 'Hierarchy child', description: '', status: 'todo', tags: [], start: '', end: '', blockedBy: [], related: [] },
      root.id,
    );

    const hierarchy = await repository.readHierarchy(testDirectory);

    expect(hierarchy.parents.get(root.id)).toBeNull();
    expect(hierarchy.parents.get(child.id)).toBe(root.id);
    expect(hierarchy.paths.get(root.id)).toContain(`task_${root.id}.txt`);
    expect(hierarchy.paths.size).toBe(hierarchy.parents.size);
  });

  it('moves a task under another parent', async () => {
    const first = await repository.createTask(testDirectory, {
      title: 'First parent',
      description: '',
      status: 'todo',
      tags: [],
      start: '',
      end: '',
      blockedBy: [],
      related: [],
    });
    const second = await repository.createTask(testDirectory, {
      title: 'Second parent',
      description: '',
      status: 'todo',
      tags: [],
      start: '',
      end: '',
      blockedBy: [],
      related: [],
    });
    const child = await repository.createTask(
      testDirectory,
      { title: 'Moved child', description: '', status: 'todo', tags: [], start: '', end: '', blockedBy: [], related: [] },
      first.id,
    );

    const path = repository.taskPath(testDirectory, child.id);
    await repository.setParent(path, second.id);

    const file = await api.readFile(path);
    expect(file.content).toContain(`parent=${second.id}`);
    expect(file.content).not.toContain(`parent=${first.id}`);

    const reloaded = await repository.loadTask(path);
    expect(reloaded.parentId).toBe(second.id);
    expect(reloaded.id).toBe(child.id);
    expect(reloaded.title).toBe('Moved child');
  });
});
