/** Task editor: create, view, edit and delete a root task. */

import {
  TASK_STATUSES,
  normalizeTags,
  type Task,
  type TaskInput,
  type TaskStatus,
} from '../core/task.js';
import { button, el, input, select, textArea } from './dom.js';
import { Modal } from './modal.js';

export type TaskDialogMode = 'view' | 'edit' | 'create';

export interface TaskDialogOptions {
  readonly doc: Document;
  readonly mode: TaskDialogMode;
  readonly task?: Task;
  readonly onSave: (input: TaskInput) => void | Promise<void>;
  readonly onDelete?: () => void | Promise<void>;
  /** Called when the user asks to switch from the read only view to the editor. */
  readonly onEdit?: () => void;
  readonly onCancel?: () => void;
}

const STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  todo: 'To do',
  doing: 'In progress',
  done: 'Done',
};

export class TaskDialog {
  private readonly doc: Document;
  private readonly mode: TaskDialogMode;
  private readonly task: Task | undefined;
  private readonly onSave: (input: TaskInput) => void | Promise<void>;
  private readonly onDelete: (() => void | Promise<void>) | undefined;
  private readonly onEdit: (() => void) | undefined;
  private readonly onCancel: (() => void) | undefined;
  private readonly modal: Modal;

  private titleInput: HTMLInputElement | null = null;
  private statusSelect: HTMLSelectElement | null = null;
  private tagsInput: HTMLInputElement | null = null;
  private descriptionInput: HTMLTextAreaElement | null = null;
  private errorLabel: HTMLDivElement | null = null;
  private confirmingDelete = false;

  constructor(options: TaskDialogOptions) {
    this.doc = options.doc;
    this.mode = options.mode;
    this.task = options.task;
    this.onSave = options.onSave;
    this.onDelete = options.onDelete;
    this.onEdit = options.onEdit;
    this.onCancel = options.onCancel;

    const title =
      options.mode === 'create'
        ? 'New task'
        : options.task !== undefined
          ? `Task #${options.task.id} - ${options.task.title}`
          : 'Task';
    this.modal = new Modal({ doc: this.doc, title, className: 'task-dialog' });
    this.modal.onClose(() => {
      this.onCancel?.();
    });
    this.render();
  }

  /** Opens the dialog. */
  open(): void {
    this.modal.open();
  }

  private render(): void {
    if (this.mode === 'view' && this.task !== undefined) {
      this.renderView(this.task);
      return;
    }
    this.renderForm();
  }

  private renderView(task: Task): void {
    const rows: HTMLElement[] = [
      this.definitionRow('Status', STATUS_LABELS[task.status]),
      this.definitionRow(
        'Tags',
        task.tags.length === 0 ? '—' : task.tags.map((tag) => `#${tag}`).join('  '),
      ),
      this.definitionRow('Created', task.created.length > 0 ? task.created : '—'),
      this.definitionRow('Updated', task.updated.length > 0 ? task.updated : '—'),
    ];

    const description = el(this.doc, 'div', {
      class: 'task-description',
      text: task.description.length > 0 ? task.description : 'No description.',
    });

    this.modal.setBody([
      el(this.doc, 'div', { class: 'task-view' }, [
        el(this.doc, 'dl', { class: 'task-meta' }, rows),
        el(this.doc, 'h3', { class: 'task-section-title', text: 'Description' }),
        description,
      ]),
    ]);

    if (this.confirmingDelete) {
      this.modal.setFooter([
        el(this.doc, 'div', { class: 'dialog-footer-left dialog-confirm' }, [
          el(this.doc, 'span', { text: 'Delete this task permanently?' }),
          button(this.doc, 'Yes, delete', {
            class: 'danger',
            onClick: () => {
              void this.runDelete();
            },
          }),
          button(this.doc, 'Keep it', {
            class: 'secondary',
            onClick: () => {
              this.confirmingDelete = false;
              this.renderView(task);
            },
          }),
        ]),
      ]);
      return;
    }

    const editButton = button(this.doc, 'Edit', {
      class: 'primary',
      onClick: () => {
        this.modal.close();
        this.onEdit?.();
      },
    });
    const deleteButton = button(this.doc, 'Delete', {
      class: 'danger',
      onClick: () => {
        this.confirmingDelete = true;
        this.renderView(task);
      },
    });
    const closeButton = button(this.doc, 'Close', {
      class: 'secondary',
      onClick: () => {
        this.modal.close();
      },
    });

    this.modal.setFooter([
      el(this.doc, 'div', { class: 'dialog-footer-left' }, [deleteButton]),
      el(this.doc, 'div', { class: 'dialog-footer-buttons' }, [closeButton, editButton]),
    ]);
  }

  private definitionRow(label: string, value: string): HTMLElement {
    return el(this.doc, 'div', { class: 'task-meta-row' }, [
      el(this.doc, 'dt', { text: label }),
      el(this.doc, 'dd', { text: value }),
    ]);
  }

  private renderForm(): void {
    const task = this.task;

    this.titleInput = input(this.doc, {
      class: 'field-input',
      id: 'task-title',
      value: task?.title ?? '',
      placeholder: 'Short description of the task',
      onKeyDown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void this.submit();
        }
      },
    });

    this.statusSelect = select(this.doc, {
      class: 'field-input',
      id: 'task-status',
      value: task?.status ?? 'todo',
      options: TASK_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] })),
    });

    this.tagsInput = input(this.doc, {
      class: 'field-input',
      id: 'task-tags',
      value: (task?.tags ?? []).join(' '),
      placeholder: 'tags separated by spaces',
    });

    this.descriptionInput = textArea(this.doc, {
      class: 'field-input',
      id: 'task-description',
      value: task?.description ?? '',
      placeholder: 'Describe the task…',
      rows: 12,
    });

    this.errorLabel = el(this.doc, 'div', { class: 'form-error' });

    const form = el(
      this.doc,
      'form',
      {
        class: 'task-form',
        on: {
          submit: (event) => {
            event.preventDefault();
            void this.submit();
          },
        },
      },
      [
        el(this.doc, 'label', { class: 'field', attrs: { for: 'task-title' } }, [
          el(this.doc, 'span', { class: 'field-label', text: 'Title' }),
          this.titleInput,
        ]),
        el(this.doc, 'div', { class: 'field-row' }, [
          el(this.doc, 'label', { class: 'field', attrs: { for: 'task-status' } }, [
            el(this.doc, 'span', { class: 'field-label', text: 'Status' }),
            this.statusSelect,
          ]),
          el(this.doc, 'label', { class: 'field', attrs: { for: 'task-tags' } }, [
            el(this.doc, 'span', { class: 'field-label', text: 'Tags' }),
            this.tagsInput,
          ]),
        ]),
        el(this.doc, 'label', { class: 'field', attrs: { for: 'task-description' } }, [
          el(this.doc, 'span', { class: 'field-label', text: 'Description' }),
          this.descriptionInput,
        ]),
        this.errorLabel,
      ],
    );

    this.modal.setBody([form]);

    const footerChildren: HTMLElement[] = [];

    if (this.mode === 'edit' && this.onDelete !== undefined) {
      footerChildren.push(
        el(this.doc, 'div', { class: 'dialog-footer-left' }, [
          this.confirmingDelete
            ? el(this.doc, 'div', { class: 'dialog-confirm' }, [
                el(this.doc, 'span', { text: 'Delete this task permanently?' }),
                button(this.doc, 'Yes, delete', {
                  class: 'danger',
                  onClick: () => {
                    void this.runDelete();
                  },
                }),
                button(this.doc, 'Keep it', {
                  class: 'secondary',
                  onClick: () => {
                    this.confirmingDelete = false;
                    this.renderForm();
                  },
                }),
              ])
            : button(this.doc, 'Delete', {
                class: 'danger',
                onClick: () => {
                  this.confirmingDelete = true;
                  this.renderForm();
                },
              }),
        ]),
      );
    }

    footerChildren.push(
      el(this.doc, 'div', { class: 'dialog-footer-buttons' }, [
        button(this.doc, 'Cancel', {
          class: 'secondary',
          onClick: () => {
            this.modal.close();
          },
        }),
        button(this.doc, this.mode === 'create' ? 'Create task' : 'Save changes', {
          class: 'primary',
          onClick: () => {
            void this.submit();
          },
        }),
      ]),
    );

    this.modal.setFooter(footerChildren);
  }

  private async submit(): Promise<void> {
    const title = this.titleInput?.value.trim() ?? '';
    if (title.length === 0) {
      this.setError('The task needs a title.');
      return;
    }

    const rawStatus = this.statusSelect?.value ?? 'todo';
    const status: TaskStatus = (TASK_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as TaskStatus)
      : 'todo';

    const taskInput: TaskInput = {
      title,
      description: this.descriptionInput?.value ?? '',
      status,
      tags: normalizeTags(this.tagsInput?.value ?? ''),
    };

    try {
      await this.onSave(taskInput);
      this.modal.close();
    } catch (error) {
      this.setError(error instanceof Error ? error.message : String(error));
    }
  }

  private async runDelete(): Promise<void> {
    if (this.onDelete === undefined) {
      return;
    }
    try {
      await this.onDelete();
      this.modal.close();
    } catch (error) {
      this.setError(error instanceof Error ? error.message : String(error));
    }
  }

  private setError(message: string): void {
    if (this.errorLabel !== null) {
      this.errorLabel.textContent = message;
    }
  }
}

/** Renders the colored badge used in the task table. */
export function statusBadge(doc: Document, status: TaskStatus): HTMLElement {
  return el(doc, 'span', {
    class: `status-badge status-${status}`,
    text: STATUS_LABELS[status],
  });
}
