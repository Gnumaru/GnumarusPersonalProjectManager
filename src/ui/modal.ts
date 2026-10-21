/** Modal dialog shell used by the file picker and the task editor. */

import { button, clear, el } from './dom.js';
import { createIcon } from './icons.js';

export interface ModalOptions {
  readonly doc: Document;
  readonly title: string;
  readonly className?: string;
  readonly labelledBy?: string;
}

export class Modal {
  readonly doc: Document;
  readonly backdrop: HTMLDivElement;
  readonly panel: HTMLDivElement;
  readonly header: HTMLDivElement;
  readonly body: HTMLDivElement;
  readonly footer: HTMLDivElement;
  private closeHandlers: (() => void)[] = [];
  private previousFocus: { focus: () => void } | null = null;
  private opened = false;

  constructor(options: ModalOptions) {
    this.doc = options.doc;

    this.body = el(options.doc, 'div', { class: 'modal-body' });
    this.footer = el(options.doc, 'div', { class: 'modal-footer' });

    const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`;
    const title = el(options.doc, 'h2', { class: 'modal-title', id: titleId, text: options.title });
    const closeButton = button(options.doc, '', {
      class: 'icon-button modal-close',
      title: 'Close',
      onClick: () => {
        this.close();
      },
    });
    closeButton.append(createIcon(options.doc, 'close'));

    this.header = el(options.doc, 'div', { class: 'modal-header' }, [title, closeButton]);
    this.panel = el(
      options.doc,
      'div',
      {
        class: `modal-panel ${options.className ?? ''}`.trim(),
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      },
      [this.header, this.body, this.footer],
    );

    this.backdrop = el(options.doc, 'div', { class: 'modal-backdrop' }, [this.panel]);
    this.backdrop.addEventListener('mousedown', (event) => {
      if (event.target === this.backdrop) {
        this.close();
      }
    });
  }

  /** Adds a handler invoked when the dialog is closed. */
  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  /** Adds the dialog to the document and focuses it. */
  open(): void {
    if (this.opened) {
      return;
    }
    this.opened = true;
    this.previousFocus = this.doc.activeElement as { focus: () => void } | null;
    this.doc.body.append(this.backdrop);
    this.doc.addEventListener('keydown', this.handleKeyDown, true);
    const focusable = this.panel.querySelector<HTMLElement>(
      'input, select, textarea, button:not(.modal-close)',
    );
    focusable?.focus();
  }

  /** Removes the dialog from the document. */
  close(): void {
    if (!this.opened) {
      return;
    }
    this.opened = false;
    this.doc.removeEventListener('keydown', this.handleKeyDown, true);
    this.backdrop.remove();
    if (this.previousFocus !== null && typeof this.previousFocus.focus === 'function') {
      this.previousFocus.focus();
    }
    for (const handler of this.closeHandlers) {
      handler();
    }
  }

  /** Replaces the content of the body. */
  setBody(children: readonly (Node | string)[]): void {
    clear(this.body);
    for (const child of children) {
      this.body.append(child);
    }
  }

  /** Replaces the content of the footer. */
  setFooter(children: readonly (Node | string)[]): void {
    clear(this.footer);
    for (const child of children) {
      this.footer.append(child);
    }
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.close();
    }
  };
}
