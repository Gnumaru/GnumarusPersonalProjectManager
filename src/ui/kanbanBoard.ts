/**
 * The board of the tasks: one column per group.
 *
 * By default only the tasks that have **no child** are shown: a task with
 * children is represented by its children, the board shows the leaves of the
 * tree. The global **Show groups** checkbox shows every task instead,
 * whether it has children or not.
 *
 * The board groups its cards by `status` (the default), `type` or `role`.
 * A card can be dragged from one column to another one to change the value it
 * is grouped by.
 */

import {
  KANBAN_GROUP_BYS,
  kanbanGroupLabel,
  kanbanGroupOf,
  kanbanGroups,
  type KanbanGroupBy,
  type TaskCard,
} from '../core/task.js';
import { el } from './dom.js';
import { createIcon } from './icons.js';

export type { KanbanGroupBy };
export { KANBAN_GROUP_BYS };

export interface KanbanHandlers {
  /** A card is dropped on a column: the grouped value of the task changes. */
  readonly onDrop: (taskId: number, target: string) => void;
  /** A card is opened. */
  readonly onOpen: (taskId: number) => void;
  /** The editor of a card is opened. */
  readonly onEdit: (taskId: number) => void;
  /** Moves the card up or down in its column. */
  readonly onReorder: (taskId: number, delta: -1 | 1) => void;
  /** Hides a card or shows it again. */
  readonly onToggleHidden: (taskId: number, hidden: boolean) => void;
  /** Shows or hides the hidden cards of a column. */
  readonly onToggleShowColumn: (group: string, show: boolean) => void;
}

/** Which hidden cards are shown on the board. */
export interface KanbanVisibility {
  /** When `true`, the hidden cards of every column are shown. */
  readonly showAllHidden: boolean;
  /** Per column toggle, `false` when the column is absent. Keys are group values. */
  readonly showHiddenByGroup: ReadonlyMap<string, boolean>;
}

/** Backwards compatible alias: visibility keyed by status. */
export interface KanbanStatusVisibility {
  readonly showAllHidden: boolean;
  readonly showHiddenByStatus: ReadonlyMap<string, boolean>;
}

/** The class of the columns of the board. */
export const COLUMN_CLASS = 'kanban-column';

/** The dropdown that chooses how the board groups its cards. */
export function renderKanbanGroupSelect(
  doc: Document,
  groupBy: KanbanGroupBy,
  onChange: (groupBy: KanbanGroupBy) => void,
): HTMLElement {
  const selectElement = doc.createElement('select');
  selectElement.className = 'kanban-group-select';
  selectElement.title = 'Group the columns by status, type or role';
  selectElement.setAttribute('aria-label', 'Group the columns by status, type or role');
  for (const grouping of KANBAN_GROUP_BYS) {
    const option = doc.createElement('option');
    option.value = grouping;
    option.textContent = grouping;
    if (grouping === groupBy) {
      option.selected = true;
    }
    selectElement.append(option);
  }
  selectElement.addEventListener('change', () => {
    const value = selectElement.value;
    if (value === 'status' || value === 'type' || value === 'role') {
      onChange(value);
    }
  });
  return el(doc, 'label', { class: 'kanban-group-label', title: 'Group the columns by status, type or role' }, [
    el(doc, 'span', { text: 'Group by' }),
    selectElement,
  ]);
}

/** The global toggles above the board: grouping, group tasks and hidden cards. */
export function renderKanbanToolbar(
  doc: Document,
  showAllHidden: boolean,
  onToggleShowAll: (show: boolean) => void,
  groupBy: KanbanGroupBy = 'status',
  onChangeGroupBy: (groupBy: KanbanGroupBy) => void = () => undefined,
  showGroups = false,
  onToggleShowGroups: (show: boolean) => void = () => undefined,
): HTMLElement {
  const hiddenCheckbox = doc.createElement('input');
  hiddenCheckbox.type = 'checkbox';
  hiddenCheckbox.className = 'kanban-show-all-hidden';
  hiddenCheckbox.checked = showAllHidden;
  hiddenCheckbox.title = 'Show every hidden card';
  hiddenCheckbox.setAttribute('aria-label', 'Show every hidden card');
  hiddenCheckbox.addEventListener('change', () => {
    onToggleShowAll(hiddenCheckbox.checked);
  });
  const groupsCheckbox = doc.createElement('input');
  groupsCheckbox.type = 'checkbox';
  groupsCheckbox.className = 'kanban-show-groups';
  groupsCheckbox.checked = showGroups;
  groupsCheckbox.title = 'Show the tasks that have children';
  groupsCheckbox.setAttribute('aria-label', 'Show the tasks that have children');
  groupsCheckbox.addEventListener('change', () => {
    onToggleShowGroups(groupsCheckbox.checked);
  });
  return el(doc, 'div', { class: 'kanban-toolbar' }, [
    renderKanbanGroupSelect(doc, groupBy, onChangeGroupBy),
    el(doc, 'label', { class: 'kanban-show-groups-label', title: 'Show the tasks that have children' }, [
      groupsCheckbox,
      el(doc, 'span', { text: 'Show groups' }),
    ]),
    el(doc, 'label', { class: 'kanban-show-all-label', title: 'Show every hidden card' }, [
      hiddenCheckbox,
      el(doc, 'span', { text: 'Show hidden' }),
    ]),
  ]);
}

function asGroupMap(visibility: KanbanVisibility | KanbanStatusVisibility): ReadonlyMap<string, boolean> {
  if ('showHiddenByGroup' in visibility) {
    return visibility.showHiddenByGroup;
  }
  return visibility.showHiddenByStatus;
}

/** Builds the board: one column per group value, with the cards of the tasks. */
export function renderKanbanBoard(
  doc: Document,
  cards: readonly TaskCard[],
  handlers: KanbanHandlers,
  commentCounts: ReadonlyMap<number, number> = new Map<number, number>(),
  visibility: KanbanVisibility | KanbanStatusVisibility = { showAllHidden: false, showHiddenByGroup: new Map() },
  groupBy: KanbanGroupBy = 'status',
): HTMLElement {
  const board = el(doc, 'div', { class: 'kanban-board' });
  const showByGroup = asGroupMap(visibility);

  for (const group of kanbanGroups(groupBy)) {
    const columnCards = cards.filter((card) => kanbanGroupOf(card, groupBy) === group);
    const showHidden = visibility.showAllHidden || (showByGroup.get(group) ?? false);
    const showColumnHidden = showByGroup.get(group) ?? false;
    const visibleCards = showHidden
      ? columnCards
      : columnCards.filter((card) => !card.kanbanHidden);
    const column = el(doc, 'section', { class: 'kanban-column' }, [
      el(doc, 'header', { class: 'kanban-column-header' }, [
        el(doc, 'span', { class: 'kanban-column-title', text: kanbanGroupLabel(group) }),
        el(doc, 'span', { class: 'kanban-column-count', text: String(visibleCards.length) }),
        renderShowHiddenToggle(doc, group, showColumnHidden, handlers),
      ]),
      el(doc, 'div', { class: 'kanban-cards' }),
    ]);
    column.dataset['group'] = group;
    if (groupBy === 'status') {
      column.dataset['status'] = group;
    } else if (groupBy === 'type') {
      column.dataset['type'] = group;
    } else {
      column.dataset['role'] = group;
    }

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
  group: string,
  show: boolean,
  handlers: KanbanHandlers,
): HTMLElement {
  const checkbox = doc.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'kanban-show-hidden';
  checkbox.checked = show;
  checkbox.title = 'Show hidden cards';
  checkbox.setAttribute('aria-label', `Show hidden cards in ${group}`);
  checkbox.addEventListener('change', () => {
    handlers.onToggleShowColumn(group, checkbox.checked);
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
