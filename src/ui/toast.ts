/** Transient notifications shown in the corner of the window. */

import { el } from './dom.js';
import { createIcon } from './icons.js';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastOptions {
  readonly doc: Document;
  readonly message: string;
  readonly kind?: ToastKind;
  readonly timeout?: number;
}

/** Shows a toast notification. */
export function showToast(options: ToastOptions): void {
  const kind = options.kind ?? 'info';
  const container = ensureContainer(options.doc);
  const toast = el(options.doc, 'div', { class: `toast toast-${kind}`, attrs: { role: 'status' } });
  toast.append(createIcon(options.doc, kind === 'error' ? 'warning' : 'check'));
  toast.append(el(options.doc, 'span', { text: options.message }));
  container.append(toast);

  const timeout = options.timeout ?? (kind === 'error' ? 7000 : 3500);
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
