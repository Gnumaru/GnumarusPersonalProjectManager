/**
 * Rows of the tree view.
 *
 * Every row shows one task: its name and its tags. A row with children can be
 * collapsed and expanded, and the actions of the task (focus, view, edit and
 * add a child) are always one click away.
 */

import type { Task } from '../core/task.js';
import type { TreeRow } from '../core/taskTree.js';
import { el } from './dom.js';
import { createIcon } from './icons.js';

export interface TreeViewHandlers {
  /**
   * Collapses or expands the task.
   *
   * `recursive` is `true` when the user held the control key: every child of
   * the task is collapsed or expanded as well.
   */
  readonly onToggle: (id: number, recursive: boolean) => void;
  /** Makes the task the root of the displayed tree. */
  readonly onFocus: (id: number) => void;
  readonly onView: (task: Task) => void;
  readonly onEdit: (task: Task) => void;
  readonly onAddChild: (task: Task) => void;
  /** Moves the task up or down among its siblings. */
  readonly onReorder: (task: Task, delta: -1 | 1) => void;
  /** Hides a task or shows it again. */
  readonly onToggleHidden: (task: Task, hidden: boolean) => void;
}

/** Width of one level of indentation, in pixels. */
export const TREE_INDENT_PX = 20;

/** Builds one row per task of the tree. */
export function renderTreeRows(
  doc: Document,
  rows: readonly TreeRow[],
  tasks: ReadonlyMap<number, Task>,
  handlers: TreeViewHandlers,
  commentCounts: ReadonlyMap<number, number> = new Map<number, number>(),
): HTMLElement[] {
  const elements: HTMLElement[] = [];
  for (const row of rows) {
    const task = tasks.get(row.id);
    if (task === undefined) {
      // The file of the task could not be read: the row is left out.
      continue;
    }
    elements.push(renderTreeRow(doc, row, task, handlers, commentCounts));
  }
  return elements;
}

function renderTreeRow(
  doc: Document,
  row: TreeRow,
  task: Task,
  handlers: TreeViewHandlers,
  commentCounts: ReadonlyMap<number, number>,
): HTMLElement {
  const indent = el(doc, 'span', { class: 'tree-indent' });
  indent.style.width = `${row.depth * TREE_INDENT_PX}px`;

  const twisty = el(doc, 'button', {
    class: 'tree-twisty',
    title: row.hasChildren
      ? row.expanded
        ? 'Collapse the child tasks (Ctrl+click collapses the whole branch)'
        : 'Show the child tasks (Ctrl+click expands the whole branch)'
      : 'This task has no child task',
  });
  twisty.type = 'button';
  twisty.dataset['taskId'] = String(task.id);
  if (row.hasChildren) {
    twisty.append(createIcon(doc, 'caret'));
    twisty.classList.add(row.expanded ? 'is-expanded' : 'is-collapsed');
    twisty.setAttribute('aria-expanded', row.expanded ? 'true' : 'false');
    twisty.setAttribute('aria-label', row.expanded ? 'Collapse the child tasks' : 'Show the child tasks');
    twisty.addEventListener('click', (event) => {
      handlers.onToggle(task.id, event.ctrlKey);
    });
  } else {
    twisty.disabled = true;
    twisty.setAttribute('aria-hidden', 'true');
  }

  const title = el(doc, 'button', {
    class: 'tree-title',
    text: task.title.length > 0 ? task.title : 'Untitled task',
    title: `#${task.id}${task.description.length > 0 ? ` - ${task.description.replace(/\s+/gu, ' ').slice(0, 120)}` : ''}`,
  });
  title.type = 'button';
  title.addEventListener('click', () => {
    handlers.onView(task);
  });

  const commentCount = commentCounts.get(task.id) ?? 0;
  const commentBadge =
    commentCount > 0
      ? el(doc, 'span', {
          class: 'comment-count',
          title: `${commentCount} comment${commentCount === 1 ? '' : 's'}`,
          text: String(commentCount),
        })
      : null;

  const tags = el(doc, 'span', { class: 'tree-tags' });
  for (const tag of task.tags) {
    tags.append(el(doc, 'span', { class: 'tag', text: tag }));
  }

  const hideCheckbox = doc.createElement('input');
  hideCheckbox.type = 'checkbox';
  hideCheckbox.className = 'tree-hide-checkbox';
  hideCheckbox.checked = task.treeGanttHidden === true;
  hideCheckbox.title = task.treeGanttHidden === true ? 'Show this task' : 'Hide this task';
  hideCheckbox.setAttribute(
    'aria-label',
    task.treeGanttHidden === true ? `Show task #${task.id}` : `Hide task #${task.id}`,
  );
  hideCheckbox.addEventListener('change', () => {
    handlers.onToggleHidden(task, hideCheckbox.checked);
  });
  const hideToggle = el(doc, 'label', { class: 'tree-hide-label', title: 'Hide this task' }, [
    hideCheckbox,
    el(doc, 'span', { text: 'Hide' }),
  ]);

  const actions = el(doc, 'span', { class: 'tree-actions' }, [
    actionButton(doc, 'up', 'Move the task up', () => {
      handlers.onReorder(task, -1);
    }),
    actionButton(doc, 'down', 'Move the task down', () => {
      handlers.onReorder(task, 1);
    }),
    actionButton(doc, 'target', 'Focus the tree on this task', () => {
      handlers.onFocus(task.id);
    }),
    actionButton(doc, 'eye', 'View task', () => {
      handlers.onView(task);
    }),
    actionButton(doc, 'pencil', 'Edit task', () => {
      handlers.onEdit(task);
    }),
    actionButton(doc, 'child', 'Add a child task', () => {
      handlers.onAddChild(task);
    }),
  ]);

  const elements: HTMLElement[] = [indent, twisty];
  if (commentBadge !== null) {
    elements.push(commentBadge);
  }
  elements.push(title, tags, hideToggle, actions);
  const element = el(
    doc,
    'div',
    { class: `tree-row${task.treeGanttHidden === true ? ' is-hidden' : ''}` },
    elements,
  );
  element.dataset['taskId'] = String(task.id);
  element.dataset['depth'] = String(row.depth);
  return element;
}

function actionButton(doc: Document, icon: string, title: string, onClick: () => void): HTMLElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'icon-button tree-action';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.append(createIcon(doc, icon));
  button.addEventListener('click', onClick);
  return button;
}
