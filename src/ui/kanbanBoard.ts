/**
 * The board of the tasks: one column per status.
 *
 * Only the tasks that have **no child** are shown: a task with children is
 * represented by its children, the board shows the leaves of the tree.
 *
 * A card can be dragged from one column to another one to change the status of
 * the task.
 */

import { BOARD_STATUSES, STATUS_LABELS, type TaskCard, type TaskStatus } from '../core/task.js';
import { el } from './dom.js';
import { createIcon } from './icons.js';

export interface KanbanHandlers {
  /** A card is dropped on a column: the status of the task changes. */
  readonly onDrop: (taskId: number, status: TaskStatus) => void;
  /** A card is opened. */
  readonly onOpen: (taskId: number) => void;
  /** The editor of a card is opened. */
  readonly onEdit: (taskId: number) => void;
  /** Moves the card up or down in its column. */
  readonly onReorder: (taskId: number, delta: -1 | 1) => void;
  /** Hides a card or shows it again. */
  readonly onToggleHidden: (taskId: number, hidden: boolean) => void;
  /** Shows or hides the hidden cards of a column. */
  readonly onToggleShowColumn: (status: TaskStatus, show: boolean) => void;
}

/** Which hidden cards are shown on the board. */
export interface KanbanVisibility {
  /** When `true`, the hidden cards of every column are shown. */
  readonly showAllHidden: boolean;
  /** Per column toggle, `false` when the column is absent. */
  readonly showHiddenByStatus: ReadonlyMap<TaskStatus, boolean>;
}

/** The class of the columns of the board. */
export const COLUMN_CLASS = 'kanban-column';

/** The global toggle above the board: shows the hidden cards of every column. */
export function renderKanbanToolbar(
  doc: Document,
  showAllHidden: boolean,
  onToggleShowAll: (show: boolean) => void,
): HTMLElement {
  const checkbox = doc.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'kanban-show-all-hidden';
  checkbox.checked = showAllHidden;
  checkbox.title = 'Show every hidden card';
  checkbox.setAttribute('aria-label', 'Show every hidden card');
  checkbox.addEventListener('change', () => {
    onToggleShowAll(checkbox.checked);
  });
  return el(doc, 'div', { class: 'kanban-toolbar' }, [
    el(doc, 'label', { class: 'kanban-show-all-label', title: 'Show every hidden card' }, [
      checkbox,
      el(doc, 'span', { text: 'Show hidden' }),
    ]),
  ]);
}

/** Builds the board: one column per status, with the cards of the tasks. */
export function renderKanbanBoard(
  doc: Document,
  cards: readonly TaskCard[],
  handlers: KanbanHandlers,
  commentCounts: ReadonlyMap<number, number> = new Map<number, number>(),
  visibility: KanbanVisibility = { showAllHidden: false, showHiddenByStatus: new Map() },
): HTMLElement {
  const board = el(doc, 'div', { class: 'kanban-board' });

  for (const status of BOARD_STATUSES) {
    const columnCards = cards.filter((card) => card.status === status);
    const showHidden =
      visibility.showAllHidden || (visibility.showHiddenByStatus.get(status) ?? false);
    const showColumnHidden = visibility.showHiddenByStatus.get(status) ?? false;
    const visibleCards = showHidden
      ? columnCards
      : columnCards.filter((card) => !card.kanbanHidden);
    const column = el(doc, 'section', { class: 'kanban-column' }, [
      el(doc, 'header', { class: 'kanban-column-header' }, [
        el(doc, 'span', { class: 'kanban-column-title', text: STATUS_LABELS[status] }),
        el(doc, 'span', { class: 'kanban-column-count', text: String(visibleCards.length) }),
        renderShowHiddenToggle(doc, status, showColumnHidden, handlers),
      ]),
      el(doc, 'div', { class: 'kanban-cards' }),
    ]);
    column.dataset['status'] = status;

    const list = column.querySelector('.kanban-cards');
    for (const card of visibleCards) {
      list?.append(renderKanbanCard(doc, card, handlers, commentCounts));
    }
    board.append(column);
  }

  return board;
}

/** The "show hidden" checkbox of a column header. */
function renderShowHiddenToggle(
  doc: Document,
  status: TaskStatus,
  show: boolean,
  handlers: KanbanHandlers,
): HTMLElement {
  const checkbox = doc.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'kanban-show-hidden';
  checkbox.checked = show;
  checkbox.title = 'Show hidden cards';
  checkbox.setAttribute('aria-label', `Show hidden cards in ${STATUS_LABELS[status]}`);
  checkbox.addEventListener('change', () => {
    handlers.onToggleShowColumn(status, checkbox.checked);
  });
  return el(doc, 'label', { class: 'kanban-show-hidden-label', title: 'Show hidden cards' }, [
    checkbox,
    el(doc, 'span', { text: 'Hidden' }),
  ]);
}

function renderKanbanCard(
  doc: Document,
  card: TaskCard,
  handlers: KanbanHandlers,
  commentCounts: ReadonlyMap<number, number> = new Map<number, number>(),
): HTMLElement {
  const title = el(doc, 'button', {
    class: 'kanban-card-title',
    text: card.title.length > 0 ? card.title : 'Untitled task',
    title: `#${card.id}`,
  });
  title.type = 'button';
  title.addEventListener('click', () => {
    handlers.onOpen(card.id);
  });

  const commentCount = commentCounts.get(card.id) ?? 0;
  const children: HTMLElement[] = [];
  if (commentCount > 0) {
    children.push(
      el(doc, 'span', {
        class: 'comment-count',
        title: `${commentCount} comment${commentCount === 1 ? '' : 's'}`,
        text: String(commentCount),
      }),
    );
  }
  children.push(title);

  const tags = el(doc, 'div', { class: 'kanban-card-tags' });
  for (const tag of card.tags) {
    tags.append(el(doc, 'span', { class: 'tag', text: tag }));
  }

  const hideCheckbox = doc.createElement('input');
  hideCheckbox.type = 'checkbox';
  hideCheckbox.className = 'kanban-hide-checkbox';
  hideCheckbox.checked = card.kanbanHidden;
  hideCheckbox.title = card.kanbanHidden ? 'Show this task' : 'Hide this task';
  hideCheckbox.setAttribute(
    'aria-label',
    card.kanbanHidden ? `Show task #${card.id}` : `Hide task #${card.id}`,
  );
  hideCheckbox.addEventListener('change', () => {
    handlers.onToggleHidden(card.id, hideCheckbox.checked);
  });
  const hideToggle = el(doc, 'label', { class: 'kanban-hide-label', title: 'Hide this task' }, [
    hideCheckbox,
    el(doc, 'span', { text: 'Hide' }),
  ]);

  const actions = el(doc, 'div', { class: 'kanban-card-actions' }, [
    actionButton(doc, 'up', 'Move the card up', () => {
      handlers.onReorder(card.id, -1);
    }),
    actionButton(doc, 'down', 'Move the card down', () => {
      handlers.onReorder(card.id, 1);
    }),
    actionButton(doc, 'eye', 'Open the task', () => {
      handlers.onOpen(card.id);
    }),
    actionButton(doc, 'pencil', 'Edit the task', () => {
      handlers.onEdit(card.id);
    }),
  ]);

  const element = el(
    doc,
    'article',
    { class: `kanban-card${card.kanbanHidden ? ' is-hidden' : ''}` },
    [...children, tags, hideToggle, actions],
  );
  element.dataset['taskId'] = String(card.id);
  return element;
}

function actionButton(doc: Document, icon: string, title: string, onClick: () => void): HTMLElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'icon-button kanban-card-action';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.append(createIcon(doc, icon));
  button.addEventListener('click', onClick);
  return button;
}
