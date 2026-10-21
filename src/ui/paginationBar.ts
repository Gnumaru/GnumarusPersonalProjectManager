/** Pagination bar: first / previous / next / last plus the page counter. */

import type { PageInfo } from '../core/pagination.js';
import { el } from './dom.js';
import { createIcon } from './icons.js';

export interface PaginationHandlers {
  readonly onPage: (page: number) => void;
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

  const summary =
    info.totalItems === 0
      ? 'No tasks'
      : `Showing ${info.firstItemIndex}-${info.lastItemIndex} of ${info.totalItems}`;

  return el(doc, 'div', { class: 'pagination-bar' }, [
    el(doc, 'div', { class: 'pagination-controls' }, [first, previous, counter, next, last]),
    el(doc, 'span', { class: 'pagination-summary', text: summary }),
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
