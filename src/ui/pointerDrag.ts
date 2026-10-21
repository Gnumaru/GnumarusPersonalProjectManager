/**
 * Mechanics of a drag driven by the pointer.
 *
 * The class takes care of everything that is the same for every drag of the
 * application:
 *
 * * the pointer has to travel a few pixels before the drag starts, so a simple
 *   click keeps its meaning;
 * * the chip that follows the pointer with the name of the dragged element;
 * * the class that dims the dragged element;
 * * the click that ends the drag is swallowed, so that no dialog opens by
 *   accident.
 *
 * What is under the pointer and what happens at the end of the drag are left
 * to the caller.
 */

import { el } from './dom.js';

/** Distance the pointer has to travel before a drag starts, in pixels. */
export const DRAG_THRESHOLD_PX = 5;

export interface PointerDragOptions {
  readonly doc: Document;
  /** The element that holds the draggable elements. */
  readonly container: HTMLElement;
  /** The classes of the elements that never start a drag. */
  readonly excludedClasses: readonly string[];
  /** The element that is going to be dragged, `null` when there is none. */
  readonly resolveSource: (target: EventTarget | null) => HTMLElement | null;
  /** The id of the dragged element. */
  readonly idOf: (source: HTMLElement) => number | null;
  /** The name of the dragged element, shown by the chip. */
  readonly labelOf: (source: HTMLElement) => string;
  /** The drag became active. */
  readonly onDragStart: (id: number, source: HTMLElement) => void;
  /** The pointer moved while the drag is active. */
  readonly onDragMove: (target: EventTarget | null, source: HTMLElement) => void;
  /** The pointer was released: the target is the element under the pointer. */
  readonly onDragEnd: (id: number, source: HTMLElement, target: EventTarget | null) => void;
}

export class PointerDrag {
  private readonly doc: Document;
  private readonly container: HTMLElement;
  private readonly options: PointerDragOptions;

  private draggedId: number | null = null;
  private source: HTMLElement | null = null;
  private originX = 0;
  private originY = 0;
  private active = false;
  private chip: HTMLElement | null = null;
  private listening = false;
  private suppressClick = false;

  constructor(options: PointerDragOptions) {
    this.doc = options.doc;
    this.container = options.container;
    this.options = options;
    this.container.addEventListener('mousedown', this.handleMouseDown);
  }

  /** Stops the controller and removes everything it added to the page. */
  dispose(): void {
    this.container.removeEventListener('mousedown', this.handleMouseDown);
    this.stopListening();
    this.endDrag();
    this.doc.removeEventListener('click', this.handleClick, true);
  }

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target;
    if (hasAnyClass(target, this.options.excludedClasses)) {
      return;
    }
    const source = this.options.resolveSource(target);
    if (source === null) {
      return;
    }
    const id = this.options.idOf(source);
    if (id === null) {
      return;
    }
    this.draggedId = id;
    this.source = source;
    this.originX = event.clientX;
    this.originY = event.clientY;
    this.active = false;
    this.startListening();
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (this.draggedId === null || this.source === null) {
      return;
    }
    if (!this.active) {
      const distance = Math.hypot(event.clientX - this.originX, event.clientY - this.originY);
      if (distance < DRAG_THRESHOLD_PX) {
        return;
      }
      this.startDrag();
    }
    // The selection of the text must not follow the pointer.
    event.preventDefault();
    this.options.onDragMove(event.target, this.source);
    this.updateChip(event);
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    const id = this.draggedId;
    const source = this.source;
    const wasActive = this.active;
    this.stopListening();
    this.endDrag();
    if (!wasActive || id === null || source === null) {
      return;
    }
    this.options.onDragEnd(id, source, event.target);
  };

  /** Swallows the click that follows a drag, so that no dialog opens. */
  private readonly handleClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };

  private startListening(): void {
    if (this.listening) {
      return;
    }
    this.listening = true;
    this.doc.addEventListener('mousemove', this.handleMouseMove, true);
    this.doc.addEventListener('mouseup', this.handleMouseUp, true);
  }

  private stopListening(): void {
    if (!this.listening) {
      return;
    }
    this.listening = false;
    this.doc.removeEventListener('mousemove', this.handleMouseMove, true);
    this.doc.removeEventListener('mouseup', this.handleMouseUp, true);
  }

  private startDrag(): void {
    this.active = true;
    this.source?.classList.add('tree-dragging');
    this.container.classList.add('tree-dragging');
    this.suppressClick = true;
    this.doc.addEventListener('click', this.handleClick, true);
    this.showChip();
    if (this.draggedId !== null && this.source !== null) {
      this.options.onDragStart(this.draggedId, this.source);
    }
  }

  private endDrag(): void {
    this.active = false;
    this.draggedId = null;
    this.source?.classList.remove('tree-dragging');
    this.source = null;
    this.container.classList.remove('tree-dragging');
    this.removeChip();
    if (!this.suppressClick) {
      return;
    }
    this.suppressClick = false;
    // The click that ends the drag is sent by the browser after the mouseup:
    // it is swallowed a moment later, so that no dialog opens.
    this.doc.defaultView?.setTimeout(() => {
      this.doc.removeEventListener('click', this.handleClick, true);
    }, 0);
  }

  /** The chip that follows the pointer with the name of the dragged element. */
  private showChip(): void {
    if (this.source === null) {
      return;
    }
    this.chip = el(this.doc, 'div', {
      class: 'tree-drag-chip',
      text: this.options.labelOf(this.source),
    });
    this.doc.body.append(this.chip);
  }

  private updateChip(event: MouseEvent): void {
    if (this.chip === null) {
      return;
    }
    this.chip.style.left = `${event.clientX + 12}px`;
    this.chip.style.top = `${event.clientY + 12}px`;
  }

  private removeChip(): void {
    this.chip?.remove();
    this.chip = null;
  }
}

/** True when the event target is inside an element with one of the classes. */
export function hasAnyClass(target: EventTarget | null, classNames: readonly string[]): boolean {
  let current: unknown = target;
  while (current !== null && typeof current === 'object') {
    const element = current as {
      classList?: { contains(value: string): boolean };
      parentNode?: unknown;
    };
    for (const className of classNames) {
      if (element.classList?.contains(className) === true) {
        return true;
      }
    }
    current = element.parentNode;
  }
  return false;
}

/**
 * The closest element with the given class that holds the event target.
 *
 * The element itself is checked first, then its ancestors.
 */
export function findByClass(target: EventTarget | null, className: string): HTMLElement | null {
  let current: unknown = target;
  while (current !== null && typeof current === 'object') {
    const element = current as {
      classList?: { contains(value: string): boolean };
      parentNode?: unknown;
    };
    if (element.classList?.contains(className) === true) {
      return element as HTMLElement;
    }
    current = element.parentNode;
  }
  return null;
}

/** True when the event target is inside the given element. */
export function isInside(target: EventTarget | null, container: HTMLElement): boolean {
  let current: unknown = target;
  while (current !== null && typeof current === 'object') {
    if (current === container) {
      return true;
    }
    current = (current as { parentNode?: unknown }).parentNode;
  }
  return false;
}

/** The id of an element, read from its `data-task-id` attribute. */
export function taskIdOf(element: HTMLElement): number | null {
  const raw = element.dataset['taskId'];
  if (raw === undefined) {
    return null;
  }
  const id = Number.parseInt(raw, 10);
  return Number.isSafeInteger(id) ? id : null;
}
