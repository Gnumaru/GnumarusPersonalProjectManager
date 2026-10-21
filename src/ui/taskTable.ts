/** Rows of the task table. */

import type { Task } from '../core/task.js';
import { formatTimestamp } from './dom.js';
import { createIcon } from './icons.js';
import { statusBadge } from './taskDialog.js';

export interface TaskTableHandlers {
  readonly onView: (task: Task) => void;
  readonly onEdit: (task: Task) => void;
  readonly onDelete: (task: Task) => void;
}

/** Builds one table row per task. */
export function renderTaskRows(
  doc: Document,
  tasks: readonly Task[],
  handlers: TaskTableHandlers,
): HTMLElement[] {
  return tasks.map((task) => renderTaskRow(doc, task, handlers));
}

function renderTaskRow(doc: Document, task: Task, handlers: TaskTableHandlers): HTMLElement {
  const titleCell = doc.createElement('td');
  titleCell.className = 'cell-title';
  const titleButton = doc.createElement('button');
  titleButton.type = 'button';
  titleButton.className = 'task-title-button';
  titleButton.textContent = task.title.length > 0 ? task.title : 'Untitled task';
  titleButton.addEventListener('click', () => {
    handlers.onView(task);
  });
  titleCell.append(titleButton);

  if (task.description.length > 0) {
    const preview = doc.createElement('span');
    preview.className = 'task-preview';
    preview.textContent = task.description.replace(/\s+/gu, ' ').slice(0, 80);
    titleCell.append(preview);
  }

  const idCell = doc.createElement('td');
  idCell.className = 'cell-id';
  idCell.textContent = String(task.id);

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
    actionButton(doc, 'trash', 'Delete task', () => {
      handlers.onDelete(task);
    }),
  );

  const row = doc.createElement('tr');
  row.dataset['taskId'] = String(task.id);
  row.append(idCell, titleCell, tagsCell, statusCell, updatedCell, actionsCell);
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
