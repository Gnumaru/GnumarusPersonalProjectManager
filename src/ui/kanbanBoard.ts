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
}

/** The class of the columns of the board. */
export const COLUMN_CLASS = 'kanban-column';

/** Builds the board: one column per status, with the cards of the tasks. */
export function renderKanbanBoard(
  doc: Document,
  cards: readonly TaskCard[],
  handlers: KanbanHandlers,
  commentCounts: ReadonlyMap<number, number> = new Map<number, number>(),
): HTMLElement {
  const board = el(doc, 'div', { class: 'kanban-board' });

  for (const status of BOARD_STATUSES) {
    const columnCards = cards.filter((card) => card.status === status);
    const column = el(doc, 'section', { class: 'kanban-column' }, [
      el(doc, 'header', { class: 'kanban-column-header' }, [
        el(doc, 'span', { class: 'kanban-column-title', text: STATUS_LABELS[status] }),
        el(doc, 'span', { class: 'kanban-column-count', text: String(columnCards.length) }),
      ]),
      el(doc, 'div', { class: 'kanban-cards' }),
    ]);
    column.dataset['status'] = status;

    const list = column.querySelector('.kanban-cards');
    for (const card of columnCards) {
      list?.append(renderKanbanCard(doc, card, handlers, commentCounts));
    }
    board.append(column);
  }

  return board;
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

  const element = el(doc, 'article', { class: 'kanban-card' }, [...children, tags, actions]);
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
