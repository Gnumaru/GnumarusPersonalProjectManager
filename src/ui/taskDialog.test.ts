import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vite-plus/test';
import {
  TASK_ROLES,
  TASK_STATUSES,
  TASK_TYPES,
  type Task,
} from '../core/task.js';
import { TaskDialog } from './taskDialog.js';

/** The stylesheet, so the tests guard that every tone owns highlight rules. */
const stylesCss = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function createDocument(): Document {
  return new JSDOM('<!doctype html><html><body></body></html>').window.document;
}

function dispatchChange(select: HTMLSelectElement): void {
  const view = select.ownerDocument.defaultView;
  if (view === null) {
    return;
  }
  select.dispatchEvent(new view.Event('change', { bubbles: true }));
}

function openCreateDialog(doc: Document): TaskDialog {
  const dialog = new TaskDialog({
    doc,
    mode: 'create',
    onSave: () => undefined,
  });
  dialog.open();
  return dialog;
}

const editTask: Task = {
  id: 3,
  title: 'Fix the crash',
  status: 'doing',
  parentId: null,
  tags: [],
  created: '20261001100000000',
  updated: '20261002110000000',
  start: '',
  end: '',
  blockedBy: [],
  related: [],
  expanded: false,
  type: 'Bug',
  role: 'Audio',
  description: '',
};

describe('colored editor dropdowns', () => {
  it('tags every status option with its tone and follows the selected status', () => {
    const doc = createDocument();
    openCreateDialog(doc);

    const select = doc.querySelector<HTMLSelectElement>('#task-status');
    expect(select).not.toBeNull();
    if (select === null) {
      return;
    }
    expect(select.options.length).toBe(TASK_STATUSES.length);
    for (const option of Array.from(select.options)) {
      expect(option.dataset['tone']).toBe(option.value);
    }
    // A new task defaults to todo.
    expect(select.value).toBe('todo');
    expect(select.dataset['tone']).toBe('todo');

    select.value = 'doing';
    dispatchChange(select);
    expect(select.dataset['tone']).toBe('doing');

    select.value = 'canceled';
    dispatchChange(select);
    expect(select.dataset['tone']).toBe('canceled');
  });

  it('colors the type options red, yellow and green', () => {
    const doc = createDocument();
    openCreateDialog(doc);

    const select = doc.querySelector<HTMLSelectElement>('#task-type');
    expect(select).not.toBeNull();
    if (select === null) {
      return;
    }
    expect(select.options.length).toBe(TASK_TYPES.length);
    for (const option of Array.from(select.options)) {
      expect(option.dataset['tone']).toBe(option.value);
    }
    expect(select.value).toBe('Feature');
    expect(select.dataset['tone']).toBe('Feature');

    select.value = 'Bug';
    dispatchChange(select);
    expect(select.dataset['tone']).toBe('Bug');

    select.value = 'Improvement';
    dispatchChange(select);
    expect(select.dataset['tone']).toBe('Improvement');
  });

  it('gives every role its own tone and follows the selected role', () => {
    const doc = createDocument();
    openCreateDialog(doc);

    const select = doc.querySelector<HTMLSelectElement>('#task-role');
    expect(select).not.toBeNull();
    if (select === null) {
      return;
    }
    expect(select.options.length).toBe(TASK_ROLES.length);
    const tones = new Set<string>();
    for (const option of Array.from(select.options)) {
      expect(option.dataset['tone']).toBe(option.value);
      tones.add(option.dataset['tone'] ?? '');
    }
    // Every role has a distinct tone.
    expect(tones.size).toBe(TASK_ROLES.length);

    expect(select.value).toBe('Programming');
    expect(select.dataset['tone']).toBe('Programming');

    select.value = 'Research';
    dispatchChange(select);
    expect(select.dataset['tone']).toBe('Research');
  });

  it('opens the editor with the tones of the task being edited', () => {
    const doc = createDocument();
    const onSave = vi.fn();
    new TaskDialog({ doc, mode: 'edit', task: editTask, onSave }).open();

    const status = doc.querySelector<HTMLSelectElement>('#task-status');
    const type = doc.querySelector<HTMLSelectElement>('#task-type');
    const role = doc.querySelector<HTMLSelectElement>('#task-role');
    expect(status?.value).toBe('doing');
    expect(status?.dataset['tone']).toBe('doing');
    expect(type?.value).toBe('Bug');
    expect(type?.dataset['tone']).toBe('Bug');
    expect(role?.value).toBe('Audio');
    expect(role?.dataset['tone']).toBe('Audio');
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('highlight tones of the editor dropdowns', () => {
  it('paints the hovered and selected option of every status with a stronger tone', () => {
    for (const status of TASK_STATUSES) {
      expect(stylesCss).toContain(`#task-status option[data-tone='${status}']:hover`);
      expect(stylesCss).toContain(`#task-status option[data-tone='${status}']:checked`);
    }
  });

  it('paints the hovered and selected option of every type with a stronger tone', () => {
    for (const type of TASK_TYPES) {
      expect(stylesCss).toContain(`#task-type option[data-tone='${type}']:hover`);
      expect(stylesCss).toContain(`#task-type option[data-tone='${type}']:checked`);
    }
  });

  it('paints the hovered and selected option of every role with a stronger tone', () => {
    for (const role of TASK_ROLES) {
      expect(stylesCss).toContain(`#task-role option[data-tone='${role}']:hover`);
      expect(stylesCss).toContain(`#task-role option[data-tone='${role}']:checked`);
    }
  });

  it('strengthens the hovered closed select of every dropdown', () => {
    for (const status of TASK_STATUSES) {
      expect(stylesCss).toContain(`#task-status[data-tone='${status}']:hover`);
    }
    for (const type of TASK_TYPES) {
      expect(stylesCss).toContain(`#task-type[data-tone='${type}']:hover`);
    }
    for (const role of TASK_ROLES) {
      expect(stylesCss).toContain(`#task-role[data-tone='${role}']:hover`);
    }
  });
});

function viewTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 3,
    title: 'Deep task',
    status: 'todo',
    parentId: 2,
    tags: [],
    created: '20261001100000000',
    updated: '20261002110000000',
    start: '',
    end: '',
    blockedBy: [],
    related: [],
    expanded: false,
    type: 'Feature',
    role: 'Programming',
    description: '',
    ...overrides,
  };
}

function openViewDialog(
  doc: Document,
  options: {
    task?: Task;
    parents?: readonly Task[];
    onOpenParent?: (parent: Task) => void;
  } = {},
): void {
  new TaskDialog({
    doc,
    mode: 'view',
    task: options.task ?? viewTask(),
    parents: options.parents,
    onOpenParent: options.onOpenParent,
    onSave: () => undefined,
  }).open();
}

describe('parent chain of the task view', () => {
  const root = viewTask({ id: 1, title: 'Root task', parentId: null });
  const middle = viewTask({ id: 2, title: 'Middle task', parentId: 1 });

  it('shows every ancestor from the root to the parent with ids and titles', () => {
    const doc = createDocument();
    openViewDialog(doc, { parents: [root, middle], onOpenParent: () => undefined });

    const links = [...doc.querySelectorAll('.task-parent-chain .task-parent-link')];
    expect(links.map((link) => link.textContent)).toEqual(['#1 Root task', '#2 Middle task']);
    // One row per ancestor: a vertical list.
    expect(doc.querySelectorAll('.task-parent-chain .task-parent-item')).toHaveLength(2);
  });

  it('truncates a long ancestor title to 64 characters', () => {
    const doc = createDocument();
    const long = viewTask({ id: 7, title: 't'.repeat(100), parentId: null });
    openViewDialog(doc, { parents: [long], onOpenParent: () => undefined });

    const text = doc.querySelector('.task-parent-chain .task-parent-link')?.textContent ?? '';
    expect(text.length).toBeLessThanOrEqual(64);
    expect(text.startsWith('#7 ')).toBe(true);
    expect(text.endsWith('…')).toBe(true);
  });

  it('shows plain names when ancestors cannot be opened', () => {
    const doc = createDocument();
    openViewDialog(doc, { parents: [root, middle] });

    expect(doc.querySelectorAll('.task-parent-chain .task-parent-link')).toHaveLength(0);
    const names = [...doc.querySelectorAll('.task-parent-chain .task-parent-name')];
    expect(names.map((name) => name.textContent)).toEqual(['#1 Root task', '#2 Middle task']);
  });

  it('opens the ancestor when its chain item is clicked', () => {
    const doc = createDocument();
    const onOpenParent = vi.fn();
    openViewDialog(doc, { parents: [root, middle], onOpenParent });

    const links = doc.querySelectorAll<HTMLButtonElement>('.task-parent-chain .task-parent-link');
    links[0]?.click();
    expect(onOpenParent).toHaveBeenCalledWith(root);
  });

  it('shows no banner for a root task', () => {
    const doc = createDocument();
    openViewDialog(doc, { task: viewTask({ parentId: null }), parents: [] });

    expect(doc.querySelector('.task-parent-banner')).toBeNull();
  });

  it('falls back to the immediate parent when no chain is given', () => {
    const doc = createDocument();
    openViewDialog(doc);

    expect(doc.querySelector('.task-parent-chain')).toBeNull();
    expect(doc.querySelector('.task-parent-banner')?.textContent).toContain('Child of task #2');
  });
});
