import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vite-plus/test';
import { KanbanDragController } from './kanbanDrag.js';

interface Harness {
  readonly dom: JSDOM;
  readonly doc: Document;
  readonly container: HTMLElement;
  readonly onDrop: ReturnType<typeof vi.fn>;
}

function createHarness(): Harness {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const doc = dom.window.document;
  const container = doc.createElement('div');
  container.className = 'kanban-wrap';
  doc.body.append(container);

  for (const status of ['todo', 'doing']) {
    const column = doc.createElement('section');
    column.className = 'kanban-column';
    column.dataset['status'] = status;
    const card = doc.createElement('article');
    card.className = 'kanban-card';
    card.dataset['taskId'] = '7';
    const title = doc.createElement('button');
    title.className = 'kanban-card-title';
    title.textContent = 'The task';
    const action = doc.createElement('button');
    action.className = 'kanban-card-action';
    card.append(title, action);
    column.append(card);
    container.append(column);
  }

  const onDrop = vi.fn();
  new KanbanDragController({ doc, container, onDrop });
  return { dom, doc, container, onDrop };
}

function columnOf(harness: Harness, status: string): HTMLElement {
  const column = harness.doc.querySelector<HTMLElement>(`.kanban-column[data-status="${status}"]`);
  if (column === null) {
    throw new Error(`The column ${status} does not exist`);
  }
  return column;
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

describe('KanbanDragController', () => {
  it('changes the status of the card when it is dropped on a column', () => {
    const harness = createHarness();
    const card = harness.doc.querySelector<HTMLElement>('.kanban-card') as HTMLElement;

    mouse(harness, 'mousedown', card, 10, 10);
    mouse(harness, 'mousemove', columnOf(harness, 'doing'), 60, 60);
    expect(columnOf(harness, 'doing').classList.contains('tree-drop-target')).toBe(true);
    mouse(harness, 'mouseup', columnOf(harness, 'doing'), 60, 60);

    expect(harness.onDrop).toHaveBeenCalledWith(7, 'doing');
  });

  it('does nothing when the pointer does not move', () => {
    const harness = createHarness();
    const card = harness.doc.querySelector<HTMLElement>('.kanban-card') as HTMLElement;

    mouse(harness, 'mousedown', card, 10, 10);
    mouse(harness, 'mouseup', card, 10, 10);

    expect(harness.onDrop).not.toHaveBeenCalled();
  });

  it('does nothing when the card is dropped outside of a column', () => {
    const harness = createHarness();
    const card = harness.doc.querySelector<HTMLElement>('.kanban-card') as HTMLElement;

    mouse(harness, 'mousedown', card, 10, 10);
    mouse(harness, 'mousemove', harness.doc.body, 60, 60);
    mouse(harness, 'mouseup', harness.doc.body, 60, 60);

    expect(harness.onDrop).not.toHaveBeenCalled();
  });

  it('does not start a drag when an action of the card is pressed', () => {
    const harness = createHarness();
    const action = harness.doc.querySelector<HTMLElement>('.kanban-card-action') as HTMLElement;

    mouse(harness, 'mousedown', action, 10, 10);
    mouse(harness, 'mousemove', columnOf(harness, 'doing'), 60, 60);
    mouse(harness, 'mouseup', columnOf(harness, 'doing'), 60, 60);

    expect(harness.onDrop).not.toHaveBeenCalled();
  });
});
