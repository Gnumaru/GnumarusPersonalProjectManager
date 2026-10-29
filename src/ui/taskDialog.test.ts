import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vite-plus/test';
import {
  TASK_ROLES,
  TASK_STATUSES,
  TASK_TYPES,
  type Task,
} from '../core/task.js';
import { TaskDialog } from './taskDialog.js';

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
