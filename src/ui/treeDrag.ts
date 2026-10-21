/**
 * Drag and drop of the rows of the tree view.
 *
 * A task can be dragged onto another one to become its child. It can also be
 * dropped on the **general root** (the first item of the breadcrumb) or on the
 * empty space of the list to become a root task again.
 *
 * The mechanics of the drag (the threshold, the chip that follows the pointer,
 * the dimming of the dragged row) come from `PointerDrag`: this class only
 * knows what is under the pointer and what happens at the end of the drag.
 */

import { PointerDrag, findByClass, isInside, taskIdOf } from './pointerDrag.js';

/**
 * The class of the element that detaches a task from its parent when it is
 * dropped on it (the **general root** of the breadcrumb).
 */
export const ROOT_TARGET_CLASS = 'tree-root-target';

/**
 * The buttons that never start a drag.
 *
 * The twisty (that collapses and expands) and the actions of the row have
 * their own behavior. The name of the task, on the other hand, is the natural
 * place to grab a task: a simple click on it still opens the task.
 */
const DRAG_EXCLUDED_CLASSES = ['tree-twisty', 'tree-action'] as const;

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
  private readonly container: HTMLElement;
  private readonly onDrop: (draggedId: number, targetId: number) => void;
  private readonly onDetach: (draggedId: number) => void;
  private readonly drag: PointerDrag;

  /** The row that is being dragged: it is not a drop target. */
  private sourceElement: HTMLElement | null = null;
  /** What is under the pointer: a task, the general root or nothing. */
  private targetKind: DropKind = 'none';
  private targetElement: HTMLElement | null = null;
  private targetId: number | null = null;

  constructor(options: TreeDragOptions) {
    this.container = options.container;
    this.onDrop = options.onDrop;
    this.onDetach = options.onDetach;
    this.drag = new PointerDrag({
      doc: options.doc,
      container: options.container,
      excludedClasses: DRAG_EXCLUDED_CLASSES,
      resolveSource: (target) => findByClass(target, 'tree-row'),
      idOf: (source) => taskIdOf(source),
      labelOf: (source) => source.querySelector('.tree-title')?.textContent ?? '',
      onDragStart: (_id, source) => {
        this.sourceElement = source;
        this.resetTarget();
      },
      onDragMove: (target) => {
        this.resolveTarget(target);
      },
      onDragEnd: (id, _source, _target) => {
        const kind = this.targetKind;
        const targetId = this.targetId;
        this.resetTarget();
        this.sourceElement = null;
        if (kind === 'task' && targetId !== null) {
          this.onDrop(id, targetId);
          return;
        }
        if (kind === 'root') {
          this.onDetach(id);
        }
      },
    });
  }

  /** Stops the controller and removes everything it added to the page. */
  dispose(): void {
    this.drag.dispose();
    this.sourceElement = null;
    this.resetTarget();
  }

  /**
   * Finds out what is under the pointer.
   *
   * A row of the list is a task, the **general root** and the empty space of
   * the list detach the task from its parent.
   */
  private resolveTarget(target: EventTarget | null): void {
    const row = findByClass(target, 'tree-row');
    if (row !== null) {
      if (row === this.sourceElement) {
        // The dragged row is not a drop target.
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

  /** Keeps the state of the drop target and updates the highlight. */
  private setTarget(kind: DropKind, element: HTMLElement | null, id: number | null): void {
    if (element !== this.targetElement) {
      this.targetElement?.classList.remove('tree-drop-target');
      this.targetElement = element;
      this.targetElement?.classList.add('tree-drop-target');
    }
    this.targetKind = kind;
    this.targetId = id;
    this.container.classList.toggle('tree-drop-root', kind === 'root');
  }

  private resetTarget(): void {
    this.targetElement?.classList.remove('tree-drop-target');
    this.targetElement = null;
    this.targetKind = 'none';
    this.targetId = null;
    this.container.classList.remove('tree-drop-root');
  }
}
