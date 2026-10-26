/**
 * The Gantt chart.
 *
 * The window is split in two: the rows of the tasks on the left, the chart on
 * the right. The chart has one column per day, the days are grouped by week
 * and the weeks by month. The weeks and the months can be collapsed.
 *
 * A bar is drawn for every task, from the day of its start date to the day of
 * its end date.
 */

import { STATUS_LABELS, type TaskStatus } from '../core/task.js';
import {
  barGeometry,
  type GanttBar,
  type GanttColumn,
  type GanttLayout,
  type GanttSchedule,
} from '../core/gantt.js';
import type { TreeRow } from '../core/taskTree.js';
import { el } from './dom.js';
import { createIcon } from './icons.js';

/** The information the chart needs about a task. */
export interface GanttTask {
  readonly id: number;
  readonly title: string;
  readonly status: TaskStatus;
  /** The bar of the task, `null` when it has no date. */
  readonly bar: GanttBar | null;
  /** The index of the first day of the bar in the schedule. */
  readonly startDay: number | null;
  /** The index of the last day of the bar in the schedule. */
  readonly endDay: number | null;
  /** `true` when the task has children. */
  readonly hasChildren: boolean;
}

export interface GanttHandlers {
  /** Collapses or expands the children of a task. */
  readonly onToggle: (id: number, recursive: boolean) => void;
  /** The chart is focused on the task. */
  readonly onFocus: (id: number) => void;
  /** The task is opened. */
  readonly onOpen: (id: number) => void;
  /** The editor of the task is opened. */
  readonly onEdit: (id: number) => void;
  /** A child of the task is created. */
  readonly onAddChild: (id: number) => void;
  /** A week is collapsed or expanded. */
  readonly onToggleWeek: (key: string) => void;
  /** A month is collapsed or expanded. */
  readonly onToggleMonth: (key: string) => void;
}

/** Width of one level of indentation of the chart, in pixels. */
export const GANTT_INDENT_PX = 9;

export interface GanttViewOptions {
  readonly doc: Document;
  readonly rows: readonly TreeRow[];
  readonly tasks: ReadonlyMap<number, GanttTask>;
  readonly schedule: GanttSchedule;
  readonly layout: GanttLayout;
}

/** Builds the Gantt chart. */
export function renderGanttView(
  options: GanttViewOptions,
  handlers: GanttHandlers,
): HTMLElement {
  const doc = options.doc;
  const { layout } = options;

  const corner = el(doc, 'div', { class: 'gantt-corner' }, [
    el(doc, 'span', { class: 'gantt-corner-title', text: 'Task' }),
  ]);

  const months = el(doc, 'div', { class: 'gantt-header-row gantt-months' });
  for (const cell of layout.months) {
    months.append(
      headerCell(doc, cell, 'gantt-month', () => {
        handlers.onToggleMonth(cell.key);
      }),
    );
  }

  const weeks = el(doc, 'div', { class: 'gantt-header-row gantt-weeks' });
  for (const cell of layout.weeks) {
    weeks.append(
      headerCell(doc, cell, 'gantt-week', () => {
        handlers.onToggleWeek(cell.key);
      }),
    );
  }

  const days = el(doc, 'div', { class: 'gantt-header-row gantt-days' });
  for (const column of layout.columns) {
    days.append(dayCell(doc, column));
  }

  const heads = el(doc, 'div', { class: 'gantt-heads' }, [months, weeks, days]);

  // The rows of the tasks and the lines of the chart live in the same row
  // tracks of the grid, through the subgrid of the two panels: the wrapped
  // names of the left side make the row taller and the chart follows it, so
  // the bars always stay beside the names.
  const side = el(doc, 'div', { class: 'gantt-side' });
  const chart = el(doc, 'div', { class: 'gantt-chart' });
  chart.append(renderStripes(doc, layout));

  for (const row of options.rows) {
    const task = options.tasks.get(row.id);
    side.append(renderSideRow(doc, row, task, handlers));
    chart.append(renderChartRow(doc, layout, task));
  }

  const grid = el(doc, 'div', { class: 'gantt-grid' }, [corner, heads]);
  if (options.rows.length > 0) {
    // The header is the first row: the panels share the row tracks of the
    // tasks that follow it.
    grid.style.gridTemplateRows = `auto repeat(${options.rows.length}, minmax(30px, auto))`;
    grid.append(side, chart);
  }

  return el(doc, 'div', { class: 'gantt-wrap' }, [grid]);
}

/**
 * The stripes of the chart: the columns alternate between a white and a very
 * light grey background.
 */
function renderStripes(doc: Document, layout: GanttLayout): HTMLElement {
  const stripes = el(doc, 'div', { class: 'gantt-stripes' });
  let left = 0;
  for (const column of layout.columns) {
    if (column.alternate) {
      const stripe = el(doc, 'div', { class: 'gantt-stripe' });
      stripe.style.left = `${left}px`;
      stripe.style.width = `${column.width}px`;
      stripes.append(stripe);
    }
    left += column.width;
  }
  return stripes;
}

/** The rows of the tasks, on the left of the chart. */
function renderSideRow(
  doc: Document,
  row: TreeRow,
  task: GanttTask | undefined,
  handlers: GanttHandlers,
): HTMLElement {
  const indent = el(doc, 'span', { class: 'gantt-indent' });
  indent.style.width = `${row.depth * GANTT_INDENT_PX}px`;

  const twisty = el(doc, 'button', {
    class: 'gantt-twisty',
    title: row.hasChildren ? 'Collapse or expand the child tasks' : 'This task has no child task',
  });
  twisty.type = 'button';
  if (row.hasChildren) {
    twisty.append(createIcon(doc, 'caret'));
    twisty.classList.add(row.expanded ? 'is-expanded' : 'is-collapsed');
    twisty.addEventListener('click', (event) => {
      const mouseEvent = event as MouseEvent;
      handlers.onToggle(task?.id ?? row.id, mouseEvent.ctrlKey);
    });
  } else {
    twisty.disabled = true;
    twisty.setAttribute('aria-hidden', 'true');
  }

  const name = el(doc, 'button', {
    class: 'gantt-row-name',
    text: task === undefined || task.title.length === 0 ? 'Untitled task' : task.title,
    title: `#${row.id}`,
  });
  name.type = 'button';
  name.addEventListener('click', () => {
    handlers.onOpen(task?.id ?? row.id);
  });

  const actions = el(doc, 'div', { class: 'gantt-row-actions' }, [
    actionButton(doc, 'target', 'Focus the chart on this task', () => {
      handlers.onFocus(task?.id ?? row.id);
    }),
    actionButton(doc, 'pencil', 'Edit the task', () => {
      handlers.onEdit(task?.id ?? row.id);
    }),
    actionButton(doc, 'child', 'Add a child task', () => {
      handlers.onAddChild(task?.id ?? row.id);
    }),
  ]);

  const element = el(doc, 'div', { class: 'gantt-row' }, [indent, twisty, name, actions]);
  element.dataset['taskId'] = String(row.id);
  element.dataset['depth'] = String(row.depth);
  return element;
}

/** One line of the chart, with the bar of the task. */
function renderChartRow(
  doc: Document,
  layout: GanttLayout,
  task: GanttTask | undefined,
): HTMLElement {
  const row = el(doc, 'div', { class: 'gantt-chart-row' });
  if (task === undefined || task.bar === null) {
    return row;
  }
  const geometry = barGeometry(layout.columns, task.bar);
  const bar = el(doc, 'div', {
    class: `gantt-bar status-${task.status}`,
    title: task.title,
  });
  bar.style.left = `${geometry.left}px`;
  bar.style.width = `${Math.max(geometry.width - 2, 4)}px`;
  bar.dataset['status'] = task.status;
  bar.dataset['taskId'] = String(task.id);
  if (task.startDay !== null) {
    bar.dataset['startDay'] = String(task.startDay);
  }
  if (task.endDay !== null) {
    bar.dataset['endDay'] = String(task.endDay);
  }
  // The handles move the start and the end of the task.
  bar.append(
    el(doc, 'span', { class: 'gantt-handle gantt-handle-start' }),
    el(doc, 'span', { class: 'gantt-bar-label', text: task.title }),
    el(doc, 'span', { class: 'gantt-handle gantt-handle-end' }),
  );
  row.append(bar);
  return row;
}

/** A cell of the header of the chart: a month or a week. */
function headerCell(
  doc: Document,
  cell: { readonly key: string; readonly number: number; readonly label: string; readonly title: string; readonly width: number; readonly collapsed: boolean },
  className: string,
  onClick: () => void,
): HTMLElement {
  const button = el(doc, 'button', { class: `${className}${cell.collapsed ? ' is-collapsed' : ''}`, title: cell.title });
  button.type = 'button';
  button.style.width = `${cell.width}px`;
  button.dataset['key'] = cell.key;
  button.append(el(doc, 'span', { class: 'gantt-header-number', text: String(cell.number) }));
  if (!cell.collapsed) {
    button.append(el(doc, 'span', { class: 'gantt-header-label', text: cell.label }));
  }
  button.addEventListener('click', onClick);
  return button;
}

/** A cell of the header of the chart: a day. */
function dayCell(doc: Document, column: GanttColumn): HTMLElement {
  const classes = ['gantt-day'];
  if (column.alternate) {
    classes.push('is-alt');
  }
  if (column.weekend) {
    classes.push('is-weekend');
  }
  const cell = el(doc, 'div', { class: classes.join(' '), title: column.title });
  cell.style.width = `${column.width}px`;
  if (column.kind === 'day') {
    cell.append(el(doc, 'span', { class: 'gantt-day-number', text: column.label }));
  }
  return cell;
}

function actionButton(doc: Document, icon: string, title: string, onClick: () => void): HTMLElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'icon-button gantt-row-action';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.append(createIcon(doc, icon));
  button.addEventListener('click', onClick);
  return button;
}

/** The name of a status, for the tooltip of a bar. */
export function statusLabel(status: TaskStatus): string {
  return STATUS_LABELS[status];
}
