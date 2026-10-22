/** Pagination bar: first / previous / next / last plus the page counter. */

import type { PageInfo } from '../core/pagination.js';
import { el } from './dom.js';
import { createIcon } from './icons.js';

export interface PaginationHandlers {
  readonly onPage: (page: number) => void;
  /** Called when the user asks for another amount of items per page. */
  readonly onPageSize?: ((pageSize: number) => void) | undefined;
  /** Shows the input that jumps to a page number. */
  readonly showPageJump?: boolean | undefined;
  /** Shows the input that changes the amount of items per page. */
  readonly showPageSize?: boolean | undefined;
  /** The name of the items, for the summary ("No notes", "3 notes"). */
  readonly itemLabel?: string | undefined;
}

/** Builds the pagination bar for the given page information. */
export function renderPaginationBar(
  doc: Document,
  info: PageInfo,
  handlers: PaginationHandlers,
): HTMLElement {
  const goTo = (page: number): void => {
    if (page < 1 || page > info.totalPages || page === info.page) {
      return;
    }
    handlers.onPage(page);
  };

  const first = iconButton(doc, 'first', 'First page', () => {
    goTo(1);
  });
  first.disabled = !info.hasPrevious;
  first.classList.add('page-first');
  first.dataset['pageAction'] = 'first';

  const previous = iconButton(doc, 'back', 'Previous page', () => {
    goTo(info.page - 1);
  });
  previous.disabled = !info.hasPrevious;
  previous.dataset['pageAction'] = 'previous';

  const next = iconButton(doc, 'forward', 'Next page', () => {
    goTo(info.page + 1);
  });
  next.disabled = !info.hasNext;
  next.dataset['pageAction'] = 'next';

  const last = iconButton(doc, 'last', 'Last page', () => {
    goTo(info.totalPages);
  });
  last.disabled = !info.hasNext;
  last.classList.add('page-last');
  last.dataset['pageAction'] = 'last';

  const counter = el(doc, 'span', { class: 'page-counter' }, [
    el(doc, 'span', { class: 'page-current', text: String(info.page) }),
    el(doc, 'span', { class: 'page-separator', text: 'of' }),
    el(doc, 'span', { class: 'page-total', text: String(info.totalPages) }),
  ]);

  const label = handlers.itemLabel;
  const summary =
    info.totalItems === 0
      ? label === undefined
        ? 'No tasks'
        : `No ${label}`
      : label === undefined
        ? `Showing ${info.firstItemIndex}-${info.lastItemIndex} of ${info.totalItems}`
        : `Showing ${info.firstItemIndex}-${info.lastItemIndex} of ${info.totalItems} ${label}`;

  const children: HTMLElement[] = [
    el(doc, 'div', { class: 'pagination-controls' }, [first, previous, counter, next, last]),
  ];

  if (handlers.showPageJump === true) {
    children.push(buildPageJump(doc, info, goTo));
  }
  if (handlers.showPageSize === true) {
    children.push(buildPageSize(doc, info, handlers));
  }

  children.push(el(doc, 'span', { class: 'pagination-summary', text: summary }));

  return el(doc, 'div', { class: 'pagination-bar' }, children);
}

/**
 * The input that jumps to a page number.
 *
 * The user types the number of the page and presses `Enter`.
 */
function buildPageJump(
  doc: Document,
  info: PageInfo,
  goTo: (page: number) => void,
): HTMLElement {
  const field = doc.createElement('input');
  field.type = 'number';
  field.className = 'page-jump-input';
  field.min = '1';
  field.max = String(info.totalPages);
  field.value = String(info.page);
  field.title = 'The number of the page, then Enter';
  field.setAttribute('aria-label', 'The number of the page');

  const jump = (): void => {
    const page = Number.parseInt(field.value, 10);
    if (!Number.isSafeInteger(page)) {
      field.value = String(info.page);
      return;
    }
    if (page < 1 || page > info.totalPages) {
      field.value = String(info.page);
      return;
    }
    goTo(page);
  };

  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      jump();
    }
  });

  const buttonElement = doc.createElement('button');
  buttonElement.type = 'button';
  buttonElement.className = 'secondary small page-jump-button';
  buttonElement.textContent = 'Go';
  buttonElement.title = 'Go to the page';
  buttonElement.addEventListener('click', jump);

  return el(doc, 'div', { class: 'pagination-jump' }, [
    el(doc, 'span', { class: 'page-jump-label', text: 'Page' }),
    field,
    buttonElement,
  ]);
}

/** The input that changes the amount of items per page. */
function buildPageSize(
  doc: Document,
  info: PageInfo,
  handlers: PaginationHandlers,
): HTMLElement {
  const field = doc.createElement('input');
  field.type = 'number';
  field.className = 'page-size-input';
  field.min = '10';
  field.max = '100';
  field.step = '1';
  field.value = String(info.pageSize);
  field.title = 'The amount of items per page, from 10 to 100';
  field.setAttribute('aria-label', 'The amount of items per page');

  const apply = (): void => {
    const size = Number.parseInt(field.value, 10);
    if (!Number.isSafeInteger(size) || size < 10 || size > 100) {
      field.value = String(info.pageSize);
      return;
    }
    handlers.onPageSize?.(size);
  };

  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      apply();
    }
  });
  field.addEventListener('change', () => {
    apply();
  });

  return el(doc, 'div', { class: 'pagination-page-size' }, [
    el(doc, 'span', { class: 'page-size-label', text: 'Per page' }),
    field,
  ]);
}

function iconButton(doc: Document, icon: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'icon-button page-button';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.append(createIcon(doc, icon));
  button.addEventListener('click', onClick);
  return button;
}
