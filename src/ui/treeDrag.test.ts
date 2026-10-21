import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vite-plus/test';
import { TreeDragController } from './treeDrag.js';

interface Harness {
  readonly dom: JSDOM;
  readonly doc: Document;
  readonly container: HTMLElement;
  readonly controller: TreeDragController;
  readonly onDrop: ReturnType<typeof vi.fn>;
  readonly onDetach: ReturnType<typeof vi.fn>;
}

function createHarness(): Harness {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const doc = dom.window.document;
  const container = doc.createElement('div');
  container.className = 'tree-rows';
  doc.body.append(container);

  for (const [id, name] of [
    [1, 'Task 1'],
    [2, 'Task 2'],
    [3, 'Task 3'],
  ] as const) {
    const row = doc.createElement('div');
    row.className = 'tree-row';
    row.dataset['taskId'] = String(id);
    const title = doc.createElement('button');
    title.className = 'tree-title';
    title.textContent = name;
    const action = doc.createElement('button');
    action.className = 'tree-action';
    row.append(title, action);
    container.append(row);
  }

  const onDrop = vi.fn();
  const onDetach = vi.fn();
  const controller = new TreeDragController({ doc, container, onDrop, onDetach });
  return { dom, doc, container, controller, onDrop, onDetach };
}

function rowOf(harness: Harness, id: number): HTMLElement {
  const row = harness.doc.querySelector<HTMLElement>(`.tree-row[data-task-id="${id}"]`);
  if (row === null) {
    throw new Error(`The row ${id} does not exist`);
  }
  return row;
}

function mouse(
  harness: Harness,
  type: 'mousedown' | 'mousemove' | 'mouseup',
  target: HTMLElement,
  x: number,
  y: number,
): void {
  target.dispatchEvent(
    new harness.dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }),
  );
}

describe('TreeDragController', () => {
  it('drops a task on the task it is dropped on', () => {
    const harness = createHarness();

    mouse(harness, 'mousedown', rowOf(harness, 3).querySelector('.tree-title') as HTMLElement, 10, 10);
    mouse(harness, 'mousemove', rowOf(harness, 1), 40, 40);
    mouse(harness, 'mouseup', rowOf(harness, 1), 40, 40);

    expect(harness.onDrop).toHaveBeenCalledWith(3, 1);
  });

  it('does nothing when the pointer does not move', () => {
    const harness = createHarness();

    mouse(harness, 'mousedown', rowOf(harness, 3).querySelector('.tree-title') as HTMLElement, 10, 10);
    mouse(harness, 'mouseup', rowOf(harness, 3), 10, 10);

    expect(harness.onDrop).not.toHaveBeenCalled();
  });

  it('does nothing when the task is dropped outside of a row', () => {
    const harness = createHarness();

    mouse(harness, 'mousedown', rowOf(harness, 3).querySelector('.tree-title') as HTMLElement, 10, 10);
    mouse(harness, 'mousemove', harness.doc.body, 40, 40);
    mouse(harness, 'mouseup', harness.doc.body, 40, 40);

    expect(harness.onDrop).not.toHaveBeenCalled();
  });

  it('does nothing when the task is dropped on itself', () => {
    const harness = createHarness();

    mouse(harness, 'mousedown', rowOf(harness, 3).querySelector('.tree-title') as HTMLElement, 10, 10);
    mouse(harness, 'mousemove', rowOf(harness, 3), 40, 40);
    mouse(harness, 'mouseup', rowOf(harness, 3), 40, 40);

    expect(harness.onDrop).not.toHaveBeenCalled();
  });

  it('highlights the row under the pointer and cleans up afterwards', () => {
    const harness = createHarness();

    mouse(harness, 'mousedown', rowOf(harness, 3).querySelector('.tree-title') as HTMLElement, 10, 10);
    mouse(harness, 'mousemove', rowOf(harness, 1), 40, 40);

    expect(rowOf(harness, 1).classList.contains('tree-drop-target')).toBe(true);
    expect(rowOf(harness, 3).classList.contains('tree-dragging')).toBe(true);
    expect(harness.doc.querySelector('.tree-drag-chip')).not.toBeNull();

    mouse(harness, 'mouseup', rowOf(harness, 1), 40, 40);

    expect(rowOf(harness, 1).classList.contains('tree-drop-target')).toBe(false);
    expect(rowOf(harness, 3).classList.contains('tree-dragging')).toBe(false);
    expect(harness.doc.querySelector('.tree-drag-chip')).toBeNull();
  });

  it('swallows the click that ends the drag', () => {
    const harness = createHarness();
    const onClick = vi.fn();
    rowOf(harness, 1).querySelector('.tree-title')?.addEventListener('click', onClick);

    mouse(harness, 'mousedown', rowOf(harness, 3).querySelector('.tree-title') as HTMLElement, 10, 10);
    mouse(harness, 'mousemove', rowOf(harness, 1), 40, 40);
    mouse(harness, 'mouseup', rowOf(harness, 1), 40, 40);
    rowOf(harness, 1).querySelector('.tree-title')?.dispatchEvent(
      new harness.dom.window.MouseEvent('click', { bubbles: true }),
    );

    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not start a drag when a button of the row is pressed', () => {
    const harness = createHarness();

    mouse(harness, 'mousedown', rowOf(harness, 3).querySelector('.tree-title') as HTMLElement, 10, 10);
    mouse(harness, 'mousemove', rowOf(harness, 1), 40, 40);
    mouse(harness, 'mouseup', rowOf(harness, 1), 40, 40);
    expect(harness.onDrop).toHaveBeenCalledWith(3, 1);

    harness.onDrop.mockClear();
    const action = rowOf(harness, 2).querySelector<HTMLElement>('.tree-action');
    if (action === null) {
      return;
    }
    mouse(harness, 'mousedown', action, 10, 10);
    mouse(harness, 'mousemove', rowOf(harness, 1), 40, 40);
    mouse(harness, 'mouseup', rowOf(harness, 1), 40, 40);

    expect(harness.onDrop).not.toHaveBeenCalled();
  });

  it('detaches the task when it is dropped on the empty space of the list', () => {
    const harness = createHarness();

    mouse(harness, 'mousedown', rowOf(harness, 3).querySelector('.tree-title') as HTMLElement, 10, 10);
    mouse(harness, 'mousemove', harness.container, 40, 400);
    mouse(harness, 'mouseup', harness.container, 40, 400);

    expect(harness.onDetach).toHaveBeenCalledWith(3);
    expect(harness.onDrop).not.toHaveBeenCalled();
  });

  it('detaches the task when it is dropped on the general root', () => {
    const harness = createHarness();
    const generalRoot = harness.doc.createElement('button');
    generalRoot.className = 'tree-crumb tree-root-target';
    harness.doc.body.append(generalRoot);

    mouse(harness, 'mousedown', rowOf(harness, 3).querySelector('.tree-title') as HTMLElement, 10, 10);
    mouse(harness, 'mousemove', generalRoot, 40, 40);
    expect(generalRoot.classList.contains('tree-drop-target')).toBe(true);
    mouse(harness, 'mouseup', generalRoot, 40, 40);

    expect(harness.onDetach).toHaveBeenCalledWith(3);
    expect(harness.onDrop).not.toHaveBeenCalled();
    expect(generalRoot.classList.contains('tree-drop-target')).toBe(false);
  });

  it('does nothing when the task is dropped outside of the tree', () => {
    const harness = createHarness();

    mouse(harness, 'mousedown', rowOf(harness, 3).querySelector('.tree-title') as HTMLElement, 10, 10);
    mouse(harness, 'mousemove', harness.doc.body, 40, 40);
    mouse(harness, 'mouseup', harness.doc.body, 40, 40);

    expect(harness.onDetach).not.toHaveBeenCalled();
    expect(harness.onDrop).not.toHaveBeenCalled();
  });
});
