/**
 * Drag and drop of the rows of the tree view.
 *
 * A task can be dragged onto another one to become its child. It can also be
 * dropped on the **general root** (the first item of the breadcrumb) or on the
 * empty space of the list to become a root task again.
 *
 * The drag is driven by the mouse (and not by the native HTML5 drag and drop)
 * so that the application controls the whole feedback: the dragged row is
 * dimmed, the row under the pointer is highlighted and a small chip follows
 * the pointer with the name of the dragged task.
 *
 * A simple click is not a drag: the pointer has to move by a few pixels
 * before the drag starts, so the buttons of the row keep working.
 */

import { el } from './dom.js';

/** Distance the pointer has to travel before a drag starts, in pixels. */
export const DRAG_THRESHOLD_PX = 5;

/**
 * The buttons that never start a drag.
 *
 * The twisty (that collapses and expands) and the actions of the row have
 * their own behavior. The name of the task, on the other hand, is the natural
 * place to grab a task: a simple click on it still opens the task.
 */
const DRAG_EXCLUDED_CLASSES = ['tree-twisty', 'tree-action'] as const;

/**
 * The class of the element that detaches a task from its parent when it is
 * dropped on it (the **general root** of the breadcrumb).
 */
export const ROOT_TARGET_CLASS = 'tree-root-target';

export interface TreeDragOptions {
  readonly doc: Document;
  /** The element that holds the rows of the tree. */
  readonly container: HTMLElement;
  /** Called when a task is dropped on another task. */
  readonly onDrop: (draggedId: number, targetId: number) => void;
  /** Called when a task is dropped on the general root: it becomes a root task. */
  readonly onDetach: (draggedId: number) => void;
}

/** What is under the pointer while a task is dragged. */
type DropKind = 'task' | 'root' | 'none';

export class TreeDragController {
  private readonly doc: Document;
  private readonly container: HTMLElement;
  private readonly onDrop: (draggedId: number, targetId: number) => void;
  private readonly onDetach: (draggedId: number) => void;

  private draggedId: number | null = null;
  private draggedRow: HTMLElement | null = null;
  /** What is under the pointer: a task, the general root or nothing. */
  private targetKind: DropKind = 'none';
  private targetElement: HTMLElement | null = null;
  private targetId: number | null = null;
  private originX = 0;
  private originY = 0;
  private dragging = false;
  private chip: HTMLElement | null = null;
  private listening = false;
  private suppressClick = false;

  constructor(options: TreeDragOptions) {
    this.doc = options.doc;
    this.container = options.container;
    this.onDrop = options.onDrop;
    this.onDetach = options.onDetach;
    this.container.addEventListener('mousedown', this.handleMouseDown);
  }

  /** Stops the controller and removes everything it added to the page. */
  dispose(): void {
    this.container.removeEventListener('mousedown', this.handleMouseDown);
    this.stopListening();
    this.endDragging();
    this.doc.removeEventListener('click', this.handleClick, true);
  }

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target;
    if (isDragExcluded(target)) {
      // The twisty and the actions of the row have their own behavior.
      return;
    }
    const row = findRow(target);
    if (row === null) {
      return;
    }
    const id = taskIdOf(row);
    if (id === null) {
      return;
    }
    this.draggedId = id;
    this.draggedRow = row;
    this.originX = event.clientX;
    this.originY = event.clientY;
    this.dragging = false;
    this.startListening();
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (this.draggedId === null) {
      return;
    }
    if (!this.dragging) {
      const distance = Math.hypot(event.clientX - this.originX, event.clientY - this.originY);
      if (distance < DRAG_THRESHOLD_PX) {
        return;
      }
      this.startDragging();
    }
    // The selection of the text must not follow the pointer.
    event.preventDefault();
    this.updateTarget(event);
  };

  private readonly handleMouseUp = (): void => {
    const draggedId = this.draggedId;
    const kind = this.targetKind;
    const targetId = this.targetId;
    const wasDragging = this.dragging;
    this.stopListening();
    this.endDragging();
    if (!wasDragging || draggedId === null) {
      return;
    }
    if (kind === 'task' && targetId !== null) {
      if (targetId !== draggedId) {
        this.onDrop(draggedId, targetId);
      }
      return;
    }
    if (kind === 'root') {
      this.onDetach(draggedId);
    }
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

  private startDragging(): void {
    this.dragging = true;
    this.draggedRow?.classList.add('tree-dragging');
    this.container.classList.add('tree-dragging');
    this.suppressClick = true;
    this.doc.addEventListener('click', this.handleClick, true);
    this.showChip();
  }

  private endDragging(): void {
    this.dragging = false;
    this.draggedId = null;
    this.draggedRow?.classList.remove('tree-dragging');
    this.draggedRow = null;
    this.container.classList.remove('tree-dragging');
    this.targetElement?.classList.remove('tree-drop-target');
    this.container.classList.remove('tree-drop-root');
    this.targetKind = 'none';
    this.targetElement = null;
    this.targetId = null;
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

  /**
   * Finds out what is under the pointer.
   *
   * A row of the list is a task, the **general root** and the empty space of
   * the list detach the task from its parent.
   */
  private resolveTarget(target: EventTarget | null): void {
    const row = findRow(target);
    if (row !== null) {
      if (row === this.draggedRow) {
        this.setTarget('none', null, null);
        return;
      }
      const id = taskIdOf(row);
      if (id === null) {
        this.setTarget('none', null, null);
        return;
      }
      this.setTarget('task', row, id);
      return;
    }

    const rootButton = findByClass(target, ROOT_TARGET_CLASS);
    if (rootButton !== null) {
      this.setTarget('root', rootButton, null);
      return;
    }

    if (isInside(target, this.container)) {
      // The empty space below the last row.
      this.setTarget('root', null, null);
      return;
    }

    this.setTarget('none', null, null);
  }

  /** Highlights the row (or the general root) the pointer is over. */
  private updateTarget(event: MouseEvent): void {
    this.resolveTarget(event.target);
    this.container.classList.toggle('tree-drop-root', this.targetKind === 'root');
    this.updateChip(event);
  }

  /** Keeps the state of the drop target and updates the highlight. */
  private setTarget(kind: DropKind, element: HTMLElement | null, id: number | null): void {
    if (element !== this.targetElement) {
      this.targetElement?.classList.remove('tree-drop-target');
      this.targetElement = element;
      this.targetElement?.classList.add('tree-drop-target');
    }
    this.targetKind = kind;
    this.targetId = id;
  }

  /** The chip that follows the pointer with the name of the dragged task. */
  private showChip(): void {
    const title = this.draggedRow?.querySelector('.tree-title')?.textContent ?? '';
    this.chip = el(this.doc, 'div', { class: 'tree-drag-chip', text: title });
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

/** The row of the tree that holds the event target, `null` when there is none. */
function findRow(target: EventTarget | null): HTMLElement | null {
  const element = findByClass(target, 'tree-row');
  return element === null ? null : (element as HTMLElement);
}

/**
 * The closest element with the given class that holds the event target.
 *
 * The element itself is checked first, then its ancestors.
 */
function findByClass(target: EventTarget | null, className: string): HTMLElement | null {
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
function isInside(target: EventTarget | null, container: HTMLElement): boolean {
  let current: unknown = target;
  while (current !== null && typeof current === 'object') {
    if (current === container) {
      return true;
    }
    current = (current as { parentNode?: unknown }).parentNode;
  }
  return false;
}

/** The id of the task of a row, `null` when the row carries none. */
function taskIdOf(row: HTMLElement): number | null {
  const raw = row.dataset['taskId'];
  if (raw === undefined) {
    return null;
  }
  const id = Number.parseInt(raw, 10);
  return Number.isSafeInteger(id) ? id : null;
}

/** True when the event target is one of the buttons that never start a drag. */
function isDragExcluded(target: EventTarget | null): boolean {
  let current: unknown = target;
  while (current !== null && typeof current === 'object') {
    const element = current as {
      classList?: { contains(value: string): boolean };
      parentNode?: unknown;
    };
    for (const className of DRAG_EXCLUDED_CLASSES) {
      if (element.classList?.contains(className) === true) {
        return true;
      }
    }
    current = element.parentNode;
  }
  return false;
}
