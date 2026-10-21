/** Rows of the task table. */

import type { Task } from '../core/task.js';
import { el, formatTimestamp } from './dom.js';
import { createIcon } from './icons.js';
import { statusBadge } from './taskDialog.js';

export interface TaskTableHandlers {
  readonly onView: (task: Task) => void;
  readonly onEdit: (task: Task) => void;
  readonly onAddChild: (task: Task) => void;
  readonly onDelete: (task: Task) => void;
  readonly onOpenParent: (parentId: number) => void;
}

/** Builds one table row per task. */
export function renderTaskRows(
  doc: Document,
  tasks: readonly Task[],
  handlers: TaskTableHandlers,
  childCounts: ReadonlyMap<number, number> = new Map<number, number>(),
): HTMLElement[] {
  return tasks.map((task) => renderTaskRow(doc, task, handlers, childCounts));
}

function renderTaskRow(
  doc: Document,
  task: Task,
  handlers: TaskTableHandlers,
  childCounts: ReadonlyMap<number, number>,
): HTMLElement {
  const titleCell = doc.createElement('td');
  titleCell.className = 'cell-title';
  const titleButton = doc.createElement('button');
  titleButton.type = 'button';
  titleButton.className = 'task-title-button';
  titleButton.textContent = task.title.length > 0 ? task.title : 'Untitled task';
  titleButton.addEventListener('click', () => {
    handlers.onView(task);
  });

  const titleLine = doc.createElement('div');
  titleLine.className = 'task-title-line';
  titleLine.append(titleButton);

  const childCount = childCounts.get(task.id) ?? 0;
  if (childCount > 0) {
    const badge = el(doc, 'span', {
      class: 'child-count',
      title: `${childCount} child task${childCount === 1 ? '' : 's'}`,
    });
    badge.append(createIcon(doc, 'child'));
    badge.append(el(doc, 'span', { text: String(childCount) }));
    titleLine.append(badge);
  }

  titleCell.append(titleLine);

  if (task.description.length > 0) {
    const preview = doc.createElement('span');
    preview.className = 'task-preview';
    preview.textContent = task.description.replace(/\s+/gu, ' ').slice(0, 80);
    titleCell.append(preview);
  }

  const idCell = doc.createElement('td');
  idCell.className = 'cell-id';
  idCell.textContent = String(task.id);

  const parentCell = doc.createElement('td');
  parentCell.className = 'cell-parent';
  if (task.parentId === null) {
    parentCell.append(el(doc, 'span', { class: 'no-parent', text: '—' }));
  } else {
    const parentButton = doc.createElement('button');
    parentButton.type = 'button';
    parentButton.className = 'parent-link';
    parentButton.textContent = `#${task.parentId}`;
    parentButton.title = `Open the parent task #${task.parentId}`;
    parentButton.addEventListener('click', () => {
      handlers.onOpenParent(task.parentId as number);
    });
    parentCell.append(parentButton);
  }

  const tagsCell = doc.createElement('td');
  tagsCell.className = 'cell-tags';
  for (const tag of task.tags) {
    const badge = doc.createElement('span');
    badge.className = 'tag';
    badge.textContent = tag;
    tagsCell.append(badge);
  }

  const statusCell = doc.createElement('td');
  statusCell.className = 'cell-status';
  statusCell.append(statusBadge(doc, task.status));

  const updatedCell = doc.createElement('td');
  updatedCell.className = 'cell-updated';
  updatedCell.textContent = formatTimestamp(task.updated);

  const actionsCell = doc.createElement('td');
  actionsCell.className = 'cell-actions';
  actionsCell.append(
    actionButton(doc, 'eye', 'View task', () => {
      handlers.onView(task);
    }),
    actionButton(doc, 'pencil', 'Edit task', () => {
      handlers.onEdit(task);
    }),
    actionButton(doc, 'child', 'Add a child task', () => {
      handlers.onAddChild(task);
    }),
    actionButton(doc, 'trash', 'Delete task', () => {
      handlers.onDelete(task);
    }),
  );

  const row = doc.createElement('tr');
  row.dataset['taskId'] = String(task.id);
  if (task.parentId !== null) {
    row.dataset['parentId'] = String(task.parentId);
    row.classList.add('task-row-child');
  }
  row.append(idCell, titleCell, parentCell, tagsCell, statusCell, updatedCell, actionsCell);
  return row;
}

function actionButton(doc: Document, icon: string, title: string, onClick: () => void): HTMLElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'icon-button row-action';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.append(createIcon(doc, icon));
  button.addEventListener('click', onClick);
  return button;
}
