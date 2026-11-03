/** Transient notifications shown in the corner of the window. */

import { el } from './dom.js';
import { createIcon } from './icons.js';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  readonly doc: Document;
  readonly message: string;
  readonly kind?: ToastKind;
  readonly timeout?: number;
  /**
   * Replaces the toast that carries the same id, instead of stacking a new
   * one. Progress steps reuse one balloon for their whole operation.
   */
  readonly id?: string;
}

/** The icon of each kind of toast. */
function toastIcon(kind: ToastKind): string {
  if (kind === 'error' || kind === 'warning') {
    return 'warning';
  }
  return kind === 'success' ? 'check' : 'info';
}

/** Shows a toast notification. */
export function showToast(options: ToastOptions): void {
  const kind = options.kind ?? 'info';
  const container = ensureContainer(options.doc);
  if (options.id !== undefined) {
    for (const child of [...container.children]) {
      if (child.getAttribute('data-toast-id') === options.id) {
        child.remove();
      }
    }
  }
  const toast = el(options.doc, 'div', {
    class: `toast toast-${kind}`,
    attrs: {
      role: kind === 'error' || kind === 'warning' ? 'alert' : 'status',
      ...(options.id === undefined ? {} : { 'data-toast-id': options.id }),
    },
  });
  toast.append(createIcon(options.doc, toastIcon(kind)));
  toast.append(el(options.doc, 'span', { text: options.message }));
  container.append(toast);

  const timeout =
    options.timeout ??
    (kind === 'error' ? 7000 : kind === 'warning' ? 6000 : 3500);
  options.doc.defaultView?.setTimeout(() => {
    toast.classList.add('toast-leaving');
    options.doc.defaultView?.setTimeout(() => {
      toast.remove();
    }, 200);
  }, timeout);
}

function ensureContainer(doc: Document): HTMLElement {
  const existing = doc.getElementById('toast-container');
  if (existing !== null) {
    return existing as HTMLElement;
  }
  const container = el(doc, 'div', { id: 'toast-container', class: 'toast-container' });
  doc.body.append(container);
  return container;
}
