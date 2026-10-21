/**
 * Drag and drop of the cards of the board.
 *
 * A card is dragged from one column to another one to change the status of the
 * task. The mechanics of the drag (the threshold, the chip that follows the
 * pointer, the dimming of the dragged card) come from `PointerDrag`.
 */

import { isTaskStatus, type TaskStatus } from '../core/task.js';
import { COLUMN_CLASS } from './kanbanBoard.js';
import { PointerDrag, findByClass } from './pointerDrag.js';

/** The buttons of a card that never start a drag. */
const DRAG_EXCLUDED_CLASSES = ['kanban-card-action'] as const;

export interface KanbanDragOptions {
  readonly doc: Document;
  /** The element that holds the columns of the board. */
  readonly container: HTMLElement;
  /** Called when a card is dropped on a column. */
  readonly onDrop: (taskId: number, status: TaskStatus) => void;
}

export class KanbanDragController {
  private readonly onDrop: (taskId: number, status: TaskStatus) => void;
  private readonly drag: PointerDrag;
  /** The column under the pointer, `null` when there is none. */
  private targetColumn: HTMLElement | null = null;

  constructor(options: KanbanDragOptions) {
    this.onDrop = options.onDrop;
    this.drag = new PointerDrag({
      doc: options.doc,
      container: options.container,
      excludedClasses: DRAG_EXCLUDED_CLASSES,
      resolveSource: (target) => findByClass(target, 'kanban-card'),
      idOf: (source) => {
        const raw = source.dataset['taskId'];
        if (raw === undefined) {
          return null;
        }
        const id = Number.parseInt(raw, 10);
        return Number.isSafeInteger(id) ? id : null;
      },
      labelOf: (source) => source.querySelector('.kanban-card-title')?.textContent ?? '',
      onDragStart: () => {
        this.clearTarget();
      },
      onDragMove: (target) => {
        this.setTarget(findByClass(target, COLUMN_CLASS));
      },
      onDragEnd: (id, _source, _target) => {
        const column = this.targetColumn;
        this.clearTarget();
        if (column === null) {
          return;
        }
        const status = column.dataset['status'];
        if (status === undefined || !isTaskStatus(status)) {
          return;
        }
        this.onDrop(id, status);
      },
    });
  }

  /** Stops the controller and removes everything it added to the page. */
  dispose(): void {
    this.drag.dispose();
    this.clearTarget();
  }

  /** Highlights the column the pointer is over. */
  private setTarget(column: HTMLElement | null): void {
    if (column === this.targetColumn) {
      return;
    }
    this.targetColumn?.classList.remove('tree-drop-target');
    this.targetColumn = column;
    this.targetColumn?.classList.add('tree-drop-target');
  }

  private clearTarget(): void {
    this.targetColumn?.classList.remove('tree-drop-target');
    this.targetColumn = null;
  }
}
