import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vite-plus/test';
import type { TaskCard } from '../core/task.js';
import { renderKanbanBoard } from './kanbanBoard.js';

function createDocument(): Document {
  return new JSDOM('<!doctype html><html><body></body></html>').window.document;
}

function card(id: number, status: TaskCard['status'], title = `Task ${id}`): TaskCard {
  return { id, title, status, parentId: null, tags: [`tag${id}`], path: `/tmp/task_${id}.txt` };
}

describe('renderKanbanBoard', () => {
  it('builds one column per status, in the expected order', () => {
    const doc = createDocument();
    const board = renderKanbanBoard(doc, [], {
      onDrop: () => undefined,
      onOpen: () => undefined,
      onEdit: () => undefined,
      onReorder: () => undefined,
    });

    const columns = [...board.querySelectorAll('.kanban-column')];
    expect(columns.map((column) => column.getAttribute('data-status'))).toEqual([
      'planning',
      'todo',
      'next',
      'paused',
      'doing',
      'done',
      'canceled',
    ]);
    expect(columns[0]?.querySelector('.kanban-column-title')?.textContent).toBe('PLANNING');
    expect(columns[3]?.querySelector('.kanban-column-title')?.textContent).toBe('PAUSED');

    // The column is colored entirely: the header holds no dot any more.
    expect(board.querySelectorAll('.kanban-column-dot')).toHaveLength(0);

    // Every column declares its status, which colors it from end to end.
    for (const column of columns) {
      expect(column.getAttribute('data-status') ?? '').not.toBe('');
    }
  });

  it('puts every card in the column of its status', () => {
    const doc = createDocument();
    const board = renderKanbanBoard(
      doc,
      [card(1, 'todo'), card(2, 'doing'), card(3, 'todo')],
      {
        onDrop: () => undefined,
        onOpen: () => undefined,
        onEdit: () => undefined,
      onReorder: () => undefined,
      },
    );

    const todo = board.querySelector('.kanban-column[data-status="todo"]');
    expect(todo?.querySelectorAll('.kanban-card')).toHaveLength(2);
    expect(todo?.querySelector('.kanban-column-count')?.textContent).toBe('2');
    expect(
      todo?.querySelector('.kanban-card[data-task-id="1"] .kanban-card-title')?.textContent,
    ).toBe('Task 1');

    const doing = board.querySelector('.kanban-column[data-status="doing"]');
    expect(doing?.querySelectorAll('.kanban-card')).toHaveLength(1);
  });

  it('shows the tags of a card', () => {
    const doc = createDocument();
    const board = renderKanbanBoard(doc, [card(1, 'todo')], {
      onDrop: () => undefined,
      onOpen: () => undefined,
      onEdit: () => undefined,
      onReorder: () => undefined,
    });

    const tags = board.querySelectorAll('.kanban-card .tag');
    expect(tags).toHaveLength(1);
    expect(tags[0]?.textContent).toBe('tag1');
  });

  it('opens and edits a task when the card is clicked', () => {
    const doc = createDocument();
    const onOpen = vi.fn();
    const onEdit = vi.fn();
    const board = renderKanbanBoard(doc, [card(1, 'todo')], { onDrop: () => undefined, onOpen, onEdit, onReorder: () => undefined });

    const element = board.querySelector('.kanban-card[data-task-id="1"]');
    const title = element?.querySelector<HTMLButtonElement>('.kanban-card-title');
    title?.click();
    expect(onOpen).toHaveBeenCalledWith(1);

    const actions = element?.querySelectorAll<HTMLButtonElement>('.kanban-card-action');
    expect(actions).toHaveLength(4);
    actions?.[3]?.click();
    expect(onEdit).toHaveBeenCalledWith(1);
  });

  it('shows an untitled task with a placeholder', () => {
    const doc = createDocument();
    const board = renderKanbanBoard(doc, [card(1, 'todo', '')], {
      onDrop: () => undefined,
      onOpen: () => undefined,
      onEdit: () => undefined,
      onReorder: () => undefined,
    });

    expect(board.querySelector('.kanban-card-title')?.textContent).toBe('Untitled task');
  });
});
