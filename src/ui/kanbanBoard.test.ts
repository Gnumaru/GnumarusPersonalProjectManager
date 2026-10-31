import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vite-plus/test';
import type { TaskCard } from '../core/task.js';
import { renderKanbanBoard, renderKanbanGroupSelect, renderKanbanToolbar } from './kanbanBoard.js';

function createDocument(): Document {
  return new JSDOM('<!doctype html><html><body></body></html>').window.document;
}

function dispatchChange(checkbox: HTMLInputElement | HTMLSelectElement): void {
  const view = checkbox.ownerDocument.defaultView;
  if (view === null) {
    return;
  }
  checkbox.dispatchEvent(new view.Event('change', { bubbles: true }));
}

function card(
  id: number,
  status: TaskCard['status'],
  title = `Task ${id}`,
  type: TaskCard['type'] = 'Feature',
  role: TaskCard['role'] = 'Programming',
): TaskCard {
  return { id, title, status, parentId: null, tags: [`tag${id}`], type, role, kanbanHidden: false, path: `/tmp/task_${id}.txt` };
}


describe('renderKanbanBoard', () => {
  it('builds one column per status, in the expected order', () => {
    const doc = createDocument();
    const board = renderKanbanBoard(doc, [], {
      onDrop: () => undefined,
      onOpen: () => undefined,
      onEdit: () => undefined,
      onReorder: () => undefined,
      onToggleHidden: () => undefined,
      onToggleShowColumn: () => undefined,
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

  it('builds one column per type when grouped by type', () => {
    const doc = createDocument();
    const board = renderKanbanBoard(
      doc,
      [],
      {
        onDrop: () => undefined,
        onOpen: () => undefined,
        onEdit: () => undefined,
        onReorder: () => undefined,
        onToggleHidden: () => undefined,
        onToggleShowColumn: () => undefined,
      },
      new Map(),
      { showAllHidden: false, showHiddenByGroup: new Map() },
      'type',
    );

    const columns = [...board.querySelectorAll('.kanban-column')];
    expect(columns.map((column) => column.getAttribute('data-type'))).toEqual([
      'Bug',
      'Improvement',
      'Feature',
    ]);
    expect(columns.map((column) => column.getAttribute('data-group'))).toEqual([
      'Bug',
      'Improvement',
      'Feature',
    ]);
    expect(columns[0]?.querySelector('.kanban-column-title')?.textContent).toBe('BUG');
  });

  it('builds one column per role when grouped by role', () => {
    const doc = createDocument();
    const board = renderKanbanBoard(
      doc,
      [],
      {
        onDrop: () => undefined,
        onOpen: () => undefined,
        onEdit: () => undefined,
        onReorder: () => undefined,
        onToggleHidden: () => undefined,
        onToggleShowColumn: () => undefined,
      },
      new Map(),
      { showAllHidden: false, showHiddenByGroup: new Map() },
      'role',
    );

    const columns = [...board.querySelectorAll('.kanban-column')];
    expect(columns.map((column) => column.getAttribute('data-role'))).toEqual([
      'Graphics',
      'Audio',
      'Programming',
      'Design',
      'Assembly',
      'Management',
      'Test',
      'Research',
    ]);
    expect(columns[2]?.querySelector('.kanban-column-title')?.textContent).toBe('PROGRAMMING');
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
      onToggleHidden: () => undefined,
      onToggleShowColumn: () => undefined,
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

  it('puts every card in the column of its type when grouped by type', () => {
    const doc = createDocument();
    const board = renderKanbanBoard(
      doc,
      [
        { ...card(1, 'todo'), type: 'Bug' },
        { ...card(2, 'todo'), type: 'Feature' },
        { ...card(3, 'doing'), type: 'Bug' },
      ],
      {
        onDrop: () => undefined,
        onOpen: () => undefined,
        onEdit: () => undefined,
        onReorder: () => undefined,
        onToggleHidden: () => undefined,
        onToggleShowColumn: () => undefined,
      },
      new Map(),
      { showAllHidden: false, showHiddenByGroup: new Map() },
      'type',
    );

    const bug = board.querySelector('.kanban-column[data-type="Bug"]');
    expect(bug?.querySelectorAll('.kanban-card')).toHaveLength(2);
    expect(bug?.querySelector('.kanban-column-count')?.textContent).toBe('2');
    const feature = board.querySelector('.kanban-column[data-type="Feature"]');
    expect(feature?.querySelectorAll('.kanban-card')).toHaveLength(1);
  });

  it('puts every card in the column of its role when grouped by role', () => {
    const doc = createDocument();
    const board = renderKanbanBoard(
      doc,
      [
        { ...card(1, 'todo'), role: 'Design' },
        { ...card(2, 'todo'), role: 'Programming' },
      ],
      {
        onDrop: () => undefined,
        onOpen: () => undefined,
        onEdit: () => undefined,
        onReorder: () => undefined,
        onToggleHidden: () => undefined,
        onToggleShowColumn: () => undefined,
      },
      new Map(),
      { showAllHidden: false, showHiddenByGroup: new Map() },
      'role',
    );

    expect(
      board.querySelector('.kanban-column[data-role="Design"]')?.querySelectorAll('.kanban-card'),
    ).toHaveLength(1);
    expect(
      board.querySelector('.kanban-column[data-role="Programming"]')?.querySelectorAll('.kanban-card'),
    ).toHaveLength(1);
  });

  it('shows the tags of a card', () => {
    const doc = createDocument();
    const board = renderKanbanBoard(doc, [card(1, 'todo')], {
      onDrop: () => undefined,
      onOpen: () => undefined,
      onEdit: () => undefined,
      onReorder: () => undefined,
      onToggleHidden: () => undefined,
      onToggleShowColumn: () => undefined,
    });

    const tags = board.querySelectorAll('.kanban-card .tag');
    expect(tags).toHaveLength(1);
    expect(tags[0]?.textContent).toBe('tag1');
  });

  it('opens and edits a task when the card is clicked', () => {
    const doc = createDocument();
    const onOpen = vi.fn();
    const onEdit = vi.fn();
    const board = renderKanbanBoard(doc, [card(1, 'todo')], { onDrop: () => undefined, onOpen, onEdit, onReorder: () => undefined, onToggleHidden: () => undefined, onToggleShowColumn: () => undefined });

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
      onToggleHidden: () => undefined,
      onToggleShowColumn: () => undefined,
    });

    expect(board.querySelector('.kanban-card-title')?.textContent).toBe('Untitled task');
  });

  it('hides the hidden cards unless their column shows them', () => {
    const doc = createDocument();
    const cards = [
      { ...card(1, 'todo'), kanbanHidden: false },
      { ...card(2, 'todo'), kanbanHidden: true },
    ];
    const handlers = {
      onDrop: () => undefined,
      onOpen: () => undefined,
      onEdit: () => undefined,
      onReorder: () => undefined,
      onToggleHidden: () => undefined,
      onToggleShowColumn: () => undefined,
    };
    const hidden = renderKanbanBoard(doc, cards, handlers);
    const todo = hidden.querySelector('.kanban-column[data-status="todo"]');
    expect(todo?.querySelectorAll('.kanban-card')).toHaveLength(1);
    expect(todo?.querySelector('.kanban-column-count')?.textContent).toBe('1');
    // The column toggle is unchecked by default.
    expect(
      todo?.querySelector<HTMLInputElement>('.kanban-show-hidden')?.checked,
    ).toBe(false);

    const shown = renderKanbanBoard(doc, cards, handlers, new Map(), {
      showAllHidden: false,
      showHiddenByGroup: new Map([['todo', true]]),
    });
    const shownTodo = shown.querySelector('.kanban-column[data-status="todo"]');
    expect(shownTodo?.querySelectorAll('.kanban-card')).toHaveLength(2);
    expect(
      shownTodo?.querySelector('.kanban-card[data-task-id="2"]')?.classList.contains('is-hidden'),
    ).toBe(true);

    const all = renderKanbanBoard(doc, cards, handlers, new Map(), {
      showAllHidden: true,
      showHiddenByGroup: new Map(),
    });
    expect(
      all.querySelector('.kanban-column[data-status="todo"] .kanban-card[data-task-id="2"]'),
    ).not.toBeNull();
  });

  it('hides the hidden cards of a type column unless it shows them', () => {
    const doc = createDocument();
    const cards = [
      { ...card(1, 'todo', 'Task 1', 'Bug'), kanbanHidden: true },
      { ...card(2, 'todo', 'Task 2', 'Bug'), kanbanHidden: false },
    ];
    const handlers = {
      onDrop: () => undefined,
      onOpen: () => undefined,
      onEdit: () => undefined,
      onReorder: () => undefined,
      onToggleHidden: () => undefined,
      onToggleShowColumn: () => undefined,
    };
    const hidden = renderKanbanBoard(doc, cards, handlers, new Map(), {
      showAllHidden: false,
      showHiddenByGroup: new Map(),
    }, 'type');
    expect(
      hidden.querySelector('.kanban-column[data-type="Bug"]')?.querySelectorAll('.kanban-card'),
    ).toHaveLength(1);
    const shown = renderKanbanBoard(doc, cards, handlers, new Map(), {
      showAllHidden: false,
      showHiddenByGroup: new Map([['Bug', true]]),
    }, 'type');
    expect(
      shown.querySelector('.kanban-column[data-type="Bug"]')?.querySelectorAll('.kanban-card'),
    ).toHaveLength(2);
  });

  it('hides a card through its checkbox', () => {
    const doc = createDocument();
    const onToggleHidden = vi.fn();
    const board = renderKanbanBoard(doc, [card(1, 'todo')], {
      onDrop: () => undefined,
      onOpen: () => undefined,
      onEdit: () => undefined,
      onReorder: () => undefined,
      onToggleHidden,
      onToggleShowColumn: () => undefined,
    });

    const checkbox = board.querySelector<HTMLInputElement>(
      '.kanban-card[data-task-id="1"] .kanban-hide-checkbox',
    );
    expect(checkbox?.checked).toBe(false);
    if (checkbox === null) {
      return;
    }
    checkbox.checked = true;
    dispatchChange(checkbox);
    expect(onToggleHidden).toHaveBeenCalledWith(1, true);
  });

  it('toggles a column through its header checkbox', () => {
    const doc = createDocument();
    const onToggleShowColumn = vi.fn();
    const board = renderKanbanBoard(doc, [card(1, 'todo')], {
      onDrop: () => undefined,
      onOpen: () => undefined,
      onEdit: () => undefined,
      onReorder: () => undefined,
      onToggleHidden: () => undefined,
      onToggleShowColumn,
    });

    const checkbox = board.querySelector<HTMLInputElement>(
      '.kanban-column[data-status="todo"] .kanban-show-hidden',
    );
    if (checkbox === null) {
      return;
    }
    checkbox.checked = true;
    dispatchChange(checkbox);
    expect(onToggleShowColumn).toHaveBeenCalledWith('todo', true);
  });

  it('toggles a type column through its header checkbox', () => {
    const doc = createDocument();
    const onToggleShowColumn = vi.fn();
    const board = renderKanbanBoard(doc, [{ ...card(1, 'todo'), type: 'Bug' }], {
      onDrop: () => undefined,
      onOpen: () => undefined,
      onEdit: () => undefined,
      onReorder: () => undefined,
      onToggleHidden: () => undefined,
      onToggleShowColumn,
    }, new Map(), { showAllHidden: false, showHiddenByGroup: new Map() }, 'type');

    const checkbox = board.querySelector<HTMLInputElement>(
      '.kanban-column[data-type="Bug"] .kanban-show-hidden',
    );
    if (checkbox === null) {
      return;
    }
    checkbox.checked = true;
    dispatchChange(checkbox);
    expect(onToggleShowColumn).toHaveBeenCalledWith('Bug', true);
  });
});

describe('renderKanbanToolbar', () => {
  it('shows a group-by dropdown defaulting to status', () => {
    const doc = createDocument();
    const toolbar = renderKanbanToolbar(doc, false, () => undefined);
    const selectElement = toolbar.querySelector<HTMLSelectElement>('.kanban-group-select');
    expect(selectElement).not.toBeNull();
    expect(selectElement?.value).toBe('status');
    expect([...(selectElement?.options ?? [])].map((option) => option.value)).toEqual([
      'status',
      'type',
      'role',
    ]);
  });

  it('notifies when the grouping changes', () => {
    const doc = createDocument();
    const onChange = vi.fn();
    const toolbar = renderKanbanToolbar(doc, false, () => undefined, 'status', onChange);
    const selectElement = toolbar.querySelector<HTMLSelectElement>('.kanban-group-select');
    if (selectElement === null) {
      return;
    }
    selectElement.value = 'type';
    dispatchChange(selectElement);
    expect(onChange).toHaveBeenCalledWith('type');
  });

  it('renders the dropdown through its helper', () => {
    const doc = createDocument();
    const onChange = vi.fn();
    const label = renderKanbanGroupSelect(doc, 'role', onChange);
    const selectElement = label.querySelector<HTMLSelectElement>('select');
    expect(selectElement?.value).toBe('role');
  });

  it('shows a show-groups checkbox defaulting to unchecked', () => {
    const doc = createDocument();
    const toolbar = renderKanbanToolbar(doc, false, () => undefined);
    const checkbox = toolbar.querySelector<HTMLInputElement>('.kanban-show-groups');
    expect(checkbox).not.toBeNull();
    expect(checkbox?.checked).toBe(false);
    expect(toolbar.querySelector('.kanban-show-groups-label')?.textContent).toContain('Show groups');
  });

  it('reflects a checked show-groups state', () => {
    const doc = createDocument();
    const toolbar = renderKanbanToolbar(
      doc,
      false,
      () => undefined,
      'status',
      () => undefined,
      true,
    );
    expect(toolbar.querySelector<HTMLInputElement>('.kanban-show-groups')?.checked).toBe(true);
  });

  it('notifies when show-groups is toggled', () => {
    const doc = createDocument();
    const onToggleShowGroups = vi.fn();
    const toolbar = renderKanbanToolbar(
      doc,
      false,
      () => undefined,
      'status',
      () => undefined,
      false,
      onToggleShowGroups,
    );
    const checkbox = toolbar.querySelector<HTMLInputElement>('.kanban-show-groups');
    if (checkbox === null) {
      return;
    }
    checkbox.checked = true;
    dispatchChange(checkbox);
    expect(onToggleShowGroups).toHaveBeenCalledWith(true);
  });
});
