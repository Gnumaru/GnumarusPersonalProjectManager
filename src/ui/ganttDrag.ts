/**
 * Drag of the bars of the Gantt chart.
 *
 * The bar of a task can be dragged to change its dates:
 *
 * * dragging the **middle** of the bar moves the task: the start and the end
 *   are shifted by the same number of days;
 * * dragging one of the **handles** of the bar changes only the start or only
 *   the end of the task.
 *
 * The end of a task can never be dragged to the day of its start (or before)
 * and its start can never be dragged to the day of its end (or after): a task
 * always lasts at least one day.
 */

import { formatTaskTimestamp } from '../core/task.js';
import {
  barGeometry,
  columnOfDay,
  dayOfIndex,
  type GanttColumn,
  type GanttSchedule,
} from '../core/gantt.js';
import { findByClass } from './pointerDrag.js';

/** What the chart currently draws. */
export interface GanttDragContext {
  /** The columns of the chart, in order. */
  readonly columns: readonly GanttColumn[];
  /** The schedule of the chart. */
  readonly schedule: GanttSchedule;
  /** The element that holds the bars: the origin of the coordinates. */
  readonly chart: HTMLElement;
}

export interface GanttDragOptions {
  readonly doc: Document;
  /** The element that holds the chart. */
  readonly container: HTMLElement;
  /** The chart currently drawn, `null` when there is none. */
  readonly context: () => GanttDragContext | null;
  /** The dates of the task changed. */
  readonly onChange: (taskId: number, start: string, end: string) => void;
}

/** What the pointer is doing with a bar. */
type DragMode = 'move' | 'start' | 'end';

interface BarDrag {
  readonly bar: HTMLElement;
  readonly taskId: number;
  readonly mode: DragMode;
  /** The day the bar was grabbed on. */
  readonly grabDay: number;
  readonly startDay: number;
  readonly endDay: number;
  /** The last position drawn, to know whether the dates changed. */
  lastStart: number;
  lastEnd: number;
}

export class GanttDragController {
  private readonly doc: Document;
  private readonly container: HTMLElement;
  private readonly options: GanttDragOptions;
  private drag: BarDrag | null = null;
  private listening = false;

  constructor(options: GanttDragOptions) {
    this.doc = options.doc;
    this.container = options.container;
    this.options = options;
    this.container.addEventListener('mousedown', this.handleMouseDown);
  }

  /** Stops the controller and removes everything it added to the page. */
  dispose(): void {
    this.container.removeEventListener('mousedown', this.handleMouseDown);
    this.stopListening();
    this.drag = null;
  }

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return;
    }
    const context = this.options.context();
    if (context === null) {
      return;
    }
    const bar = findByClass(event.target, 'gantt-bar');
    if (bar === null) {
      return;
    }
    const taskId = readNumber(bar, 'taskId');
    const startDay = readNumber(bar, 'startDay');
    const endDay = readNumber(bar, 'endDay');
    if (taskId === null || startDay === null || endDay === null) {
      return;
    }
    const mode = resolveMode(event.target);
    const grabDay = this.dayAt(context, event.clientX);
    if (grabDay === null) {
      return;
    }

    event.preventDefault();
    this.drag = {
      bar,
      taskId,
      mode,
      grabDay,
      startDay,
      endDay,
      lastStart: startDay,
      lastEnd: endDay,
    };
    bar.classList.add('is-dragging');
    this.startListening();
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    const drag = this.drag;
    const context = this.options.context();
    if (drag === null || context === null) {
      return;
    }
    const pointerDay = this.dayAt(context, event.clientX);
    if (pointerDay === null) {
      return;
    }
    event.preventDefault();

    const last = context.columns[context.columns.length - 1];
    const lastDay = last === undefined ? pointerDay : last.firstDayIndex + last.days - 1;

    let start = drag.startDay;
    let end = drag.endDay;

    if (drag.mode === 'move') {
      const delta = pointerDay - drag.grabDay;
      start = clamp(drag.startDay + delta, 0, lastDay);
      end = clamp(drag.endDay + delta, 0, lastDay);
      if (end - start !== drag.endDay - drag.startDay) {
        // The bar does not fit any more: it keeps its length.
        start = Math.max(0, Math.min(start, lastDay - (drag.endDay - drag.startDay)));
        end = start + (drag.endDay - drag.startDay);
      }
    } else if (drag.mode === 'start') {
      // The end of the task is never moved: the start stays before it.
      start = Math.min(pointerDay, end - 1);
    } else {
      // The start of the task is never moved: the end stays after it.
      end = Math.max(pointerDay, start + 1);
    }

    drag.lastStart = start;
    drag.lastEnd = end;
    this.drawBar(context, drag, start, end);
  };

  private readonly handleMouseUp = (): void => {
    const drag = this.drag;
    const context = this.options.context();
    this.stopListening();
    this.drag = null;
    drag?.bar.classList.remove('is-dragging');
    if (drag === null || context === null) {
      return;
    }
    if (drag.lastStart === drag.startDay && drag.lastEnd === drag.endDay) {
      // Nothing moved.
      return;
    }
    const start = formatTaskTimestamp(dayOfIndex(context.schedule, drag.lastStart));
    const end = formatTaskTimestamp(dayOfIndex(context.schedule, drag.lastEnd));
    this.options.onChange(drag.taskId, start, end);
  };

  /** Moves the bar on the screen while the user drags it. */
  private drawBar(
    context: GanttDragContext,
    drag: BarDrag,
    startDay: number,
    endDay: number,
  ): void {
    const first = columnOfDay(context.columns, startDay);
    const last = columnOfDay(context.columns, endDay);
    if (first === null || last === null) {
      return;
    }
    const geometry = barGeometry(context.columns, {
      first: Math.min(first, last),
      last: Math.max(first, last),
    });
    drag.bar.style.left = `${geometry.left}px`;
    drag.bar.style.width = `${Math.max(geometry.width - 2, 4)}px`;
  }

  /** The day of the schedule under the pointer. */
  private dayAt(context: GanttDragContext, clientX: number): number | null {
    const rect = context.chart.getBoundingClientRect();
    const x = clientX - rect.left;
    let offset = 0;
    for (const column of context.columns) {
      if (x < offset + column.width) {
        return column.firstDayIndex;
      }
      offset += column.width;
    }
    const last = context.columns[context.columns.length - 1];
    return last === undefined ? null : last.firstDayIndex;
  }

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
}

/** What the pointer grabbed: a handle or the body of the bar. */
function resolveMode(target: EventTarget | null): DragMode {
  if (findByClass(target, 'gantt-handle-start') !== null) {
    return 'start';
  }
  if (findByClass(target, 'gantt-handle-end') !== null) {
    return 'end';
  }
  return 'move';
}

/** A number written in a data attribute of the bar. */
function readNumber(element: HTMLElement, name: string): number | null {
  const raw = element.dataset[name];
  if (raw === undefined) {
    return null;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) ? value : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
