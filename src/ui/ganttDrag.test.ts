import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vite-plus/test';
import { buildLayout, buildSchedule, DAY_WIDTH_PX } from '../core/gantt.js';
import { GanttDragController } from './ganttDrag.js';

interface Harness {
  readonly dom: JSDOM;
  readonly doc: Document;
  readonly chart: HTMLElement;
  readonly controller: GanttDragController;
  readonly onChange: ReturnType<typeof vi.fn>;
}

function createHarness(): Harness {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const doc = dom.window.document;
  const container = doc.createElement('div');
  const chart = doc.createElement('div');
  container.append(chart);
  doc.body.append(container);

  // The schedule covers the 18th and the 31st of October 2026.
  const schedule = buildSchedule(new Date(2026, 9, 18), new Date(2026, 9, 31));
  const layout = buildLayout(schedule, new Set<string>());

  const bar = doc.createElement('div');
  bar.className = 'gantt-bar';
  bar.dataset['taskId'] = '5';
  bar.dataset['startDay'] = '3';
  bar.dataset['endDay'] = '6';
  const start = doc.createElement('span');
  start.className = 'gantt-handle gantt-handle-start';
  const end = doc.createElement('span');
  end.className = 'gantt-handle gantt-handle-end';
  const label = doc.createElement('span');
  label.className = 'gantt-bar-label';
  bar.append(start, label, end);
  chart.append(bar);

  const onChange = vi.fn();
  const controller = new GanttDragController({
    doc,
    container,
    context: () => ({ columns: layout.columns, schedule, chart }),
    onChange,
  });
  return { dom, doc, chart, controller, onChange };
}

function mouse(
  harness: Harness,
  type: 'mousedown' | 'mousemove' | 'mouseup',
  target: Element,
  x: number,
): void {
  target.dispatchEvent(
    new harness.dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: 10, button: 0 }),
  );
}

describe('GanttDragController', () => {
  it('moves the whole bar when the middle is dragged', () => {
    const harness = createHarness();
    const label = harness.doc.querySelector('.gantt-bar-label') as HTMLElement;

    // The bar is grabbed on its third day and dropped three days later: the
    // start and the end are shifted by the same number of days.
    mouse(harness, 'mousedown', label, 3 * DAY_WIDTH_PX + 4);
    mouse(harness, 'mousemove', label, 6 * DAY_WIDTH_PX + 4);
    mouse(harness, 'mouseup', label, 6 * DAY_WIDTH_PX + 4);

    expect(harness.onChange).toHaveBeenCalledWith(5, '20261024000000000', '20261027000000000');
  });

  it('changes only the start when the left handle is dragged', () => {
    const harness = createHarness();
    const handle = harness.doc.querySelector('.gantt-handle-start') as HTMLElement;

    mouse(harness, 'mousedown', handle, 0);
    mouse(harness, 'mousemove', handle, DAY_WIDTH_PX);
    mouse(harness, 'mouseup', handle, DAY_WIDTH_PX);

    // The start moved to the first day, the end did not move.
    expect(harness.onChange).toHaveBeenCalledWith(5, '20261019000000000', '20261024000000000');
  });

  it('changes only the end when the right handle is dragged', () => {
    const harness = createHarness();
    const handle = harness.doc.querySelector('.gantt-handle-end') as HTMLElement;

    mouse(harness, 'mousedown', handle, 7 * DAY_WIDTH_PX);
    mouse(harness, 'mousemove', handle, 9 * DAY_WIDTH_PX);
    mouse(harness, 'mouseup', handle, 9 * DAY_WIDTH_PX);

    expect(harness.onChange).toHaveBeenCalledWith(5, '20261021000000000', '20261027000000000');
  });

  it('never lets the end of a task reach its start', () => {
    const harness = createHarness();
    const handle = harness.doc.querySelector('.gantt-handle-end') as HTMLElement;

    // The end is dragged on the start of the task: it stops one day before.
    mouse(harness, 'mousedown', handle, 7 * DAY_WIDTH_PX);
    mouse(harness, 'mousemove', handle, 3 * DAY_WIDTH_PX);
    mouse(harness, 'mouseup', handle, 3 * DAY_WIDTH_PX);

    expect(harness.onChange).toHaveBeenCalledWith(5, '20261021000000000', '20261022000000000');
  });

  it('never lets the start of a task reach its end', () => {
    const harness = createHarness();
    const handle = harness.doc.querySelector('.gantt-handle-start') as HTMLElement;

    // The start is dragged on the end of the task: it stops one day after.
    mouse(harness, 'mousedown', handle, 0);
    mouse(harness, 'mousemove', handle, 6 * DAY_WIDTH_PX);
    mouse(harness, 'mouseup', handle, 6 * DAY_WIDTH_PX);

    expect(harness.onChange).toHaveBeenCalledWith(5, '20261023000000000', '20261024000000000');
  });

  it('does nothing when the bar is not moved', () => {
    const harness = createHarness();
    const label = harness.doc.querySelector('.gantt-bar-label') as HTMLElement;

    mouse(harness, 'mousedown', label, 3 * DAY_WIDTH_PX + 4);
    mouse(harness, 'mouseup', label, 3 * DAY_WIDTH_PX + 4);

    expect(harness.onChange).not.toHaveBeenCalled();
  });
});
