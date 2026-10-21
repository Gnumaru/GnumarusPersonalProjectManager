import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vite-plus/test';
import type { Task, TaskStatus } from '../core/task.js';
import { renderTaskRows } from './taskTable.js';
import { renderPaginationBar } from './paginationBar.js';
import { statusBadge } from './taskDialog.js';
import { computePageInfo } from '../core/pagination.js';

function createDocument(): Document {
  return new JSDOM('<!doctype html><html><body></body></html>').window.document;
}

const task: Task = {
  id: 7,
  title: 'Write the report',
  status: 'doing',
  parentId: null,
  tags: ['docs', 'urgent'],
  created: '2026-10-01T10:00:00.000Z',
  updated: '2026-10-02T11:00:00.000Z',
  description: 'The description of the task',
};

describe('renderTaskRows', () => {
  it('builds one row per task', () => {
    const doc = createDocument();
    const rows = renderTaskRows(
      doc,
      [task],
      {
        onView: () => undefined,
        onEdit: () => undefined,
        onAddChild: () => undefined,
        onDelete: () => undefined,
        onOpenParent: () => undefined,
      },
    );

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.tagName).toBe('TR');
    expect(row?.dataset['taskId']).toBe('7');
    expect(row?.querySelector('.cell-id')?.textContent).toBe('7');
    expect(row?.querySelector('.cell-title')?.textContent).toContain('Write the report');
    expect(row?.querySelectorAll('.cell-tags .tag')).toHaveLength(2);
    expect(row?.querySelector('.cell-status .status-badge')?.textContent).toBe('DOING');
    expect(row?.querySelector('.cell-parent')?.textContent).toBe('—');
  });

  it('shows the parent of a child task', () => {
    const doc = createDocument();
    const rows = renderTaskRows(
      doc,
      [{ ...task, parentId: 3 }],
      {
        onView: () => undefined,
        onEdit: () => undefined,
        onAddChild: () => undefined,
        onDelete: () => undefined,
        onOpenParent: () => undefined,
      },
    );

    const row = rows[0];
    expect(row?.dataset['parentId']).toBe('3');
    expect(row?.classList.contains('task-row-child')).toBe(true);
    expect(row?.querySelector('.parent-link')?.textContent).toBe('#3');
  });

  it('opens the parent task when the parent link is clicked', () => {
    const doc = createDocument();
    const onOpenParent = vi.fn();
    const rows = renderTaskRows(
      doc,
      [{ ...task, parentId: 3 }],
      {
        onView: () => undefined,
        onEdit: () => undefined,
        onAddChild: () => undefined,
        onDelete: () => undefined,
        onOpenParent,
      },
    );
    rows[0]?.querySelector<HTMLButtonElement>('.parent-link')?.click();
    expect(onOpenParent).toHaveBeenCalledWith(3);
  });

  it('shows how many children a task has', () => {
    const doc = createDocument();
    const rows = renderTaskRows(
      doc,
      [task],
      {
        onView: () => undefined,
        onEdit: () => undefined,
        onAddChild: () => undefined,
        onDelete: () => undefined,
        onOpenParent: () => undefined,
      },
      new Map([[7, 3]]),
    );
    expect(rows[0]?.querySelector('.child-count')?.textContent).toContain('3');
  });

  it('calls the handlers when the buttons are clicked', () => {
    const doc = createDocument();
    const onView = vi.fn();
    const onEdit = vi.fn();
    const onAddChild = vi.fn();
    const onDelete = vi.fn();
    const rows = renderTaskRows(doc, [task], {
      onView,
      onEdit,
      onAddChild,
      onDelete,
      onOpenParent: () => undefined,
    });

    const titleButton = rows[0]?.querySelector<HTMLButtonElement>('.task-title-button');
    titleButton?.click();
    expect(onView).toHaveBeenCalledWith(task);

    const actions = rows[0]?.querySelectorAll<HTMLButtonElement>('.row-action');
    expect(actions).toHaveLength(4);
    actions?.[1]?.click();
    expect(onEdit).toHaveBeenCalledWith(task);
    actions?.[2]?.click();
    expect(onAddChild).toHaveBeenCalledWith(task);
    actions?.[3]?.click();
    expect(onDelete).toHaveBeenCalledWith(task);
  });

  it('shows an empty title as "Untitled task"', () => {
    const doc = createDocument();
    const rows = renderTaskRows(
      doc,
      [{ ...task, title: '' }],
      {
        onView: () => undefined,
        onEdit: () => undefined,
        onAddChild: () => undefined,
        onDelete: () => undefined,
        onOpenParent: () => undefined,
      },
    );
    expect(rows[0]?.querySelector('.task-title-button')?.textContent).toBe('Untitled task');
  });
});

describe('statusBadge', () => {
  it('shows the name of every status', () => {
    const doc = createDocument();
    const expected: ReadonlyArray<readonly [TaskStatus, string]> = [
      ['planning', 'PLANNING'],
      ['next', 'NEXT'],
      ['todo', 'TODO'],
      ['doing', 'DOING'],
      ['paused', 'PAUSED'],
      ['done', 'DONE'],
      ['canceled', 'CANCELED'],
    ];

    for (const [status, label] of expected) {
      const badge = statusBadge(doc, status);
      expect(badge.textContent).toBe(label);
      expect(badge.classList.contains(`status-${status}`)).toBe(true);
    }
  });
});

describe('renderPaginationBar', () => {
  it('disables the previous buttons on the first page', () => {
    const doc = createDocument();
    const bar = renderPaginationBar(doc, computePageInfo(1, 10, 25), { onPage: () => undefined });

    const buttons = bar.querySelectorAll<HTMLButtonElement>('.page-button');
    expect(buttons).toHaveLength(4);
    expect(buttons[0]?.disabled).toBe(true);
    expect(buttons[1]?.disabled).toBe(true);
    expect(buttons[2]?.disabled).toBe(false);
    expect(buttons[3]?.disabled).toBe(false);
    expect(bar.querySelector('.page-current')?.textContent).toBe('1');
    expect(bar.querySelector('.page-total')?.textContent).toBe('3');
    expect(bar.querySelector('.pagination-summary')?.textContent).toBe('Showing 1-10 of 25');
  });

  it('disables the next buttons on the last page', () => {
    const doc = createDocument();
    const bar = renderPaginationBar(doc, computePageInfo(3, 10, 25), { onPage: () => undefined });
    const buttons = bar.querySelectorAll<HTMLButtonElement>('.page-button');
    expect(buttons[0]?.disabled).toBe(false);
    expect(buttons[1]?.disabled).toBe(false);
    expect(buttons[2]?.disabled).toBe(true);
    expect(buttons[3]?.disabled).toBe(true);
    expect(bar.querySelector('.pagination-summary')?.textContent).toBe('Showing 21-25 of 25');
  });

  it('asks for the first, previous, next and last page', () => {
    const doc = createDocument();
    const onPage = vi.fn();
    const bar = renderPaginationBar(doc, computePageInfo(2, 10, 25), { onPage });
    const buttons = bar.querySelectorAll<HTMLButtonElement>('.page-button');

    buttons[0]?.click();
    buttons[1]?.click();
    buttons[2]?.click();
    buttons[3]?.click();

    expect(onPage).toHaveBeenNthCalledWith(1, 1);
    expect(onPage).toHaveBeenNthCalledWith(2, 1);
    expect(onPage).toHaveBeenNthCalledWith(3, 3);
    expect(onPage).toHaveBeenNthCalledWith(4, 3);
  });

  it('does not ask for the page that is already shown', () => {
    const doc = createDocument();
    const onPage = vi.fn();
    const bar = renderPaginationBar(doc, computePageInfo(1, 10, 25), { onPage });
    const buttons = bar.querySelectorAll<HTMLButtonElement>('.page-button');
    buttons[0]?.click();
    expect(onPage).not.toHaveBeenCalled();
  });
});
