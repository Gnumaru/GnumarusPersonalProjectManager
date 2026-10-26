import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vite-plus/test';
import {
  barOf,
  buildLayout,
  buildSchedule,
  type GanttLayout,
  type GanttSchedule,
} from '../core/gantt.js';
import type { TreeRow } from '../core/taskTree.js';
import {
  GANTT_INDENT_PX,
  renderGanttView,
  type GanttHandlers,
  type GanttTask,
} from './ganttView.js';

function createDocument(): Document {
  return new JSDOM('<!doctype html><html><body></body></html>').window.document;
}

function createSchedule(): GanttSchedule {
  return buildSchedule(new Date(2026, 9, 19), new Date(2026, 9, 23));
}

function createLayout(schedule: GanttSchedule): GanttLayout {
  return buildLayout(schedule, new Set());
}

const rows: readonly TreeRow[] = [
  { id: 1, depth: 0, hasChildren: true, expanded: true },
  { id: 2, depth: 1, hasChildren: true, expanded: false },
  { id: 3, depth: 2, hasChildren: false, expanded: false },
];

function createTasks(layout: GanttLayout): ReadonlyMap<number, GanttTask> {
  return new Map<number, GanttTask>([
    [
      1,
      {
        id: 1,
        title: 'Root task',
        status: 'todo',
        bar: barOf(layout.columns, 0, 4),
        startDay: 0,
        endDay: 4,
        hasChildren: true,
      },
    ],
    [
      2,
      {
        id: 2,
        title: 'Child task',
        status: 'doing',
        bar: barOf(layout.columns, 1, 2),
        startDay: 1,
        endDay: 2,
        hasChildren: true,
      },
    ],
    [
      3,
      {
        id: 3,
        title: 'Grandchild task',
        status: 'done',
        bar: barOf(layout.columns, 2, 3),
        startDay: 2,
        endDay: 3,
        hasChildren: false,
      },
    ],
  ]);
}

function createHandlers(): {
  readonly handlers: GanttHandlers;
  readonly onFocus: ReturnType<typeof vi.fn>;
  readonly onAddChild: ReturnType<typeof vi.fn>;
  readonly onEdit: ReturnType<typeof vi.fn>;
} {
  const onFocus = vi.fn();
  const onAddChild = vi.fn();
  const onEdit = vi.fn();
  return {
    onFocus,
    onAddChild,
    onEdit,
    handlers: {
      onToggle: vi.fn(),
      onFocus,
      onOpen: vi.fn(),
      onEdit,
      onAddChild,
      onToggleWeek: vi.fn(),
      onToggleMonth: vi.fn(),
    },
  };
}

function render(): HTMLElement {
  const doc = createDocument();
  const schedule = createSchedule();
  const layout = createLayout(schedule);
  return renderGanttView(
    { doc, rows, tasks: createTasks(layout), schedule, layout },
    createHandlers().handlers,
  );
}

describe('renderGanttView', () => {
  it('indents every level by half of the indentation of the tree', () => {
    const doc = createDocument();
    const schedule = createSchedule();
    const layout = createLayout(schedule);
    const view = renderGanttView(
      { doc, rows, tasks: createTasks(layout), schedule, layout },
      createHandlers().handlers,
    );

    const indents = [...view.querySelectorAll<HTMLElement>('.gantt-indent')];
    expect(GANTT_INDENT_PX).toBe(9);
    expect(indents.map((indent) => indent.style.width)).toEqual(['0px', '9px', '18px']);
  });

  it('offers the focus and the add-child actions, like the tree view', () => {
    const doc = createDocument();
    const schedule = createSchedule();
    const layout = createLayout(schedule);
    const { handlers, onFocus, onAddChild, onEdit } = createHandlers();
    const view = renderGanttView(
      { doc, rows, tasks: createTasks(layout), schedule, layout },
      handlers,
    );

    const row = view.querySelector<HTMLElement>('.gantt-row[data-task-id="2"]');
    const actions = [...(row?.querySelectorAll<HTMLButtonElement>('.gantt-row-action') ?? [])];
    expect(actions.map((action) => action.title)).toEqual([
      'Focus the chart on this task',
      'Edit the task',
      'Add a child task',
    ]);

    actions[0]?.click();
    actions[1]?.click();
    actions[2]?.click();
    expect(onFocus).toHaveBeenCalledWith(2);
    expect(onEdit).toHaveBeenCalledWith(2);
    expect(onAddChild).toHaveBeenCalledWith(2);
  });

  it('keeps every name row and its chart row on the same line of the grid', () => {
    const view = render();

    // The header plus one shared track per task: the side panel and the chart
    // use those tracks as a subgrid, so a wrapped name stretches both.
    const grid = view.querySelector<HTMLElement>('.gantt-grid');
    expect(grid?.style.gridTemplateRows).toBe(
      `auto repeat(${rows.length}, minmax(30px, auto))`,
    );

    // The two panels are siblings of the header and each holds one row per task.
    const side = grid?.querySelector<HTMLElement>('.gantt-side');
    const chart = grid?.querySelector<HTMLElement>('.gantt-chart');
    expect(side).not.toBeNull();
    expect(chart).not.toBeNull();

    const sideRows = [...(side?.querySelectorAll<HTMLElement>('.gantt-row') ?? [])];
    const chartRows = [...(chart?.querySelectorAll<HTMLElement>('.gantt-chart-row') ?? [])];
    expect(sideRows).toHaveLength(rows.length);
    expect(chartRows).toHaveLength(rows.length);
    expect(sideRows.map((row) => row.dataset['taskId'])).toEqual(['1', '2', '3']);
    expect(
      chartRows.map((row) => row.querySelector('.gantt-bar')?.getAttribute('data-task-id')),
    ).toEqual(['1', '2', '3']);

    // The background stripes cover the whole body of the chart.
    expect(chart?.querySelector('.gantt-stripes')).not.toBeNull();
  });
});
