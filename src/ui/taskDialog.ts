/** Task editor: create, view, edit and delete a task (root or child). */

import {
  STATUS_LABELS,
  TASK_STATUSES,
  dateInputValue,
  normalizeTags,
  timestampFromDateInput,
  type Task,
  type TaskInput,
  type TaskStatus,
} from '../core/task.js';
import { button, clear, el, formatTimestamp, input, select, textArea } from './dom.js';
import type { TaskComment } from '../core/comment.js';
import { IdListField } from './idListField.js';
import { createIcon } from './icons.js';
import { Modal } from './modal.js';

export type TaskDialogMode = 'view' | 'edit' | 'create';

export interface TaskDialogOptions {
  readonly doc: Document;
  readonly mode: TaskDialogMode;
  readonly task?: Task | undefined;
  /** The parent task, when the task being created is a child of it. */
  readonly parent?: Task | undefined;
  /** The children of the task being viewed. */
  readonly children?: readonly Task[] | undefined;
  readonly onSave: (input: TaskInput) => void | Promise<void>;
  readonly onDelete?: (() => void | Promise<void>) | undefined;
  /** Called when the user asks to switch from the read only view to the editor. */
  readonly onEdit?: (() => void) | undefined;
  /** Called when the user asks to create a child of the task. */
  readonly onAddChild?: (() => void) | undefined;
  /** Called when the user clicks one of the children. */
  readonly onOpenChild?: ((child: Task) => void) | undefined;
  /** Reads the comments of a task. */
  readonly onLoadComments?: ((taskId: number) => Promise<readonly TaskComment[]>) | undefined;
  /** Adds a comment to a task. */
  readonly onAddComment?: ((taskId: number, text: string) => Promise<void>) | undefined;
  /** Changes the text of a comment. */
  readonly onUpdateComment?: ((taskId: number, commentId: number, text: string) => Promise<void>) | undefined;
  /** Deletes a comment. */
  readonly onDeleteComment?: ((taskId: number, commentId: number) => Promise<void>) | undefined;
  readonly onCancel?: (() => void) | undefined;
}

export class TaskDialog {
  private readonly doc: Document;
  private readonly mode: TaskDialogMode;
  private readonly task: Task | undefined;
  private readonly parent: Task | undefined;
  private readonly children: readonly Task[];
  private readonly onSave: (input: TaskInput) => void | Promise<void>;
  private readonly onDelete: (() => void | Promise<void>) | undefined;
  private readonly onEdit: (() => void) | undefined;
  private readonly onAddChild: (() => void) | undefined;
  private readonly onOpenChild: ((child: Task) => void) | undefined;
  private readonly onLoadComments: ((taskId: number) => Promise<readonly TaskComment[]>) | undefined;
  private readonly onAddComment: ((taskId: number, text: string) => Promise<void>) | undefined;
  private readonly onUpdateComment:
    | ((taskId: number, commentId: number, text: string) => Promise<void>)
    | undefined;
  private readonly onDeleteComment: ((taskId: number, commentId: number) => Promise<void>) | undefined;
  private readonly onCancel: (() => void) | undefined;
  private readonly modal: Modal;

  private titleInput: HTMLInputElement | null = null;
  private statusSelect: HTMLSelectElement | null = null;
  private tagsInput: HTMLInputElement | null = null;
  private startInput: HTMLInputElement | null = null;
  private endInput: HTMLInputElement | null = null;
  private descriptionInput: HTMLTextAreaElement | null = null;
  private errorLabel: HTMLDivElement | null = null;
  private confirmingDelete = false;
  /** The ids of the tasks that block the task. */
  private blockedByIds: number[];
  /** The ids of the tasks that are related to the task. */
  private relatedIds: number[];
  /** The comments of the task, the most recent first. */
  private comments: readonly TaskComment[] = [];
  /** The comment that is being edited, `null` when none is. */
  private editingCommentId: number | null = null;
  /** The text of the comment that is being written. */
  private newCommentText = '';
  private commentsElement: HTMLElement | null = null;

  constructor(options: TaskDialogOptions) {
    this.doc = options.doc;
    this.mode = options.mode;
    this.task = options.task;
    this.parent = options.parent;
    this.children = options.children ?? [];
    this.onSave = options.onSave;
    this.onDelete = options.onDelete;
    this.onEdit = options.onEdit;
    this.onAddChild = options.onAddChild;
    this.onOpenChild = options.onOpenChild;
    this.onLoadComments = options.onLoadComments;
    this.onAddComment = options.onAddComment;
    this.onUpdateComment = options.onUpdateComment;
    this.onDeleteComment = options.onDeleteComment;
    this.onCancel = options.onCancel;
    this.blockedByIds = [...(options.task?.blockedBy ?? [])];
    this.relatedIds = [...(options.task?.related ?? [])];

    const title =
      options.mode === 'create'
        ? options.parent !== undefined
          ? `New child of task #${options.parent.id}`
          : 'New task'
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
    void this.loadComments();
  }

  /**
   * Reads the comments of the task.
   *
   * The comments are only shown when the task already exists: a task that is
   * being created has no comment yet.
   */
  private async loadComments(): Promise<void> {
    const task = this.task;
    if (task === undefined || this.onLoadComments === undefined) {
      return;
    }
    try {
      this.comments = await this.onLoadComments(task.id);
    } catch (error) {
      this.comments = [];
      this.setError(error instanceof Error ? error.message : String(error));
    }
    this.renderComments();
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
      this.definitionRow('Created', task.created.length > 0 ? formatTimestamp(task.created) : '—'),
      this.definitionRow('Updated', task.updated.length > 0 ? formatTimestamp(task.updated) : '—'),
      this.definitionRow('Start', task.start.length > 0 ? formatTimestamp(task.start) : '—'),
      this.definitionRow('End', task.end.length > 0 ? formatTimestamp(task.end) : '—'),
      this.definitionRow(
        'Blocked by',
        task.blockedBy.length === 0 ? '—' : task.blockedBy.map((id) => `#${id}`).join('  '),
      ),
      this.definitionRow(
        'Related',
        task.related.length === 0 ? '—' : task.related.map((id) => `#${id}`).join('  '),
      ),
    ];

    const description = el(this.doc, 'div', {
      class: 'task-description',
      text: task.description.length > 0 ? task.description : 'No description.',
    });

    const body: HTMLElement[] = [];

    if (task.parentId !== null) {
      body.push(
        el(this.doc, 'div', { class: 'task-parent-banner' }, [
          createIcon(this.doc, 'child'),
          el(this.doc, 'span', {
            text: `Child of task #${task.parentId}`,
          }),
        ]),
      );
    }

    body.push(
      el(this.doc, 'div', { class: 'task-view' }, [
        el(this.doc, 'dl', { class: 'task-meta' }, rows),
        el(this.doc, 'h3', { class: 'task-section-title', text: 'Description' }),
        description,
      ]),
    );

    if (this.onAddChild !== undefined) {
      body.push(
        el(this.doc, 'div', { class: 'task-children' }, [
          el(this.doc, 'h3', {
            class: 'task-section-title',
            text: `Children (${this.children.length})`,
          }),
          this.renderChildren(),
        ]),
      );
    }

    this.modal.setBody(body);

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

    const footerLeft: HTMLElement[] = [];
    if (this.onDelete !== undefined) {
      footerLeft.push(
        button(this.doc, 'Delete', {
          class: 'danger',
          onClick: () => {
            this.confirmingDelete = true;
            this.renderView(task);
          },
        }),
      );
    }
    if (this.onAddChild !== undefined) {
      footerLeft.push(
        button(this.doc, 'Add child task', {
          class: 'secondary',
          onClick: () => {
            this.modal.close();
            this.onAddChild?.();
          },
        }),
      );
    }

    const editButton = button(this.doc, 'Edit', {
      class: 'primary',
      onClick: () => {
        this.modal.close();
        this.onEdit?.();
      },
    });
    const closeButton = button(this.doc, 'Close', {
      class: 'secondary',
      onClick: () => {
        this.modal.close();
      },
    });

    this.modal.setFooter([
      el(this.doc, 'div', { class: 'dialog-footer-left' }, footerLeft),
      el(this.doc, 'div', { class: 'dialog-footer-buttons' }, [closeButton, editButton]),
    ]);
  }

  private renderChildren(): HTMLElement {
    if (this.children.length === 0) {
      return el(this.doc, 'p', {
        class: 'task-children-empty',
        text: 'This task has no child yet.',
      });
    }

    const list = el(this.doc, 'ul', { class: 'child-list' });
    for (const child of this.children) {
      const item = el(this.doc, 'li', { class: 'child-item' }, [
        el(this.doc, 'span', { class: 'child-id', text: `#${child.id}` }),
        el(this.doc, 'button', {
          class: 'child-title',
          text: child.title.length > 0 ? child.title : 'Untitled task',
          attrs: { type: 'button' },
          on: {
            click: () => {
              this.modal.close();
              this.onOpenChild?.(child);
            },
          },
        }),
        statusBadge(this.doc, child.status),
      ]);
      list.append(item);
    }
    return list;
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

    this.startInput = input(this.doc, {
      class: 'field-input',
      id: 'task-start',
      type: 'date',
      value: dateInputValue(task?.start ?? ''),
      title: 'The day the task starts',
    });

    this.endInput = input(this.doc, {
      class: 'field-input',
      id: 'task-end',
      type: 'date',
      value: dateInputValue(task?.end ?? ''),
      title: 'The day the task ends',
    });

    // The tasks that block this one and the tasks that are related to it.
    const blockedByField = new IdListField({
      doc: this.doc,
      label: 'Blocked by',
      placeholder: 'id of the task, then Enter',
      values: this.blockedByIds,
      excluded: task === undefined ? [] : [task.id],
      onChange: (values) => {
        this.blockedByIds = values;
      },
    });

    const relatedField = new IdListField({
      doc: this.doc,
      label: 'Related tasks',
      placeholder: 'id of the task, then Enter',
      values: this.relatedIds,
      excluded: task === undefined ? [] : [task.id],
      onChange: (values) => {
        this.relatedIds = values;
      },
    });

    this.descriptionInput = textArea(this.doc, {
      class: 'field-input',
      id: 'task-description',
      value: task?.description ?? '',
      placeholder: 'Describe the task…',
      rows: 12,
    });

    this.errorLabel = el(this.doc, 'div', { class: 'form-error' });

    const formChildren: HTMLElement[] = [];

    if (this.parent !== undefined) {
      formChildren.push(
        el(this.doc, 'div', { class: 'task-parent-banner' }, [
          createIcon(this.doc, 'child'),
          el(this.doc, 'span', {
            text: `New child of task #${this.parent.id} - ${this.parent.title}`,
          }),
        ]),
      );
    } else if (task?.parentId !== null && task?.parentId !== undefined) {
      formChildren.push(
        el(this.doc, 'div', { class: 'task-parent-banner' }, [
          createIcon(this.doc, 'child'),
          el(this.doc, 'span', { text: `Child of task #${task.parentId}` }),
        ]),
      );
    }

    formChildren.push(
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
      el(this.doc, 'div', { class: 'field-row field-row-even' }, [
        el(this.doc, 'label', { class: 'field', attrs: { for: 'task-start' } }, [
          el(this.doc, 'span', { class: 'field-label', text: 'Start date' }),
          this.startInput,
        ]),
        el(this.doc, 'label', { class: 'field', attrs: { for: 'task-end' } }, [
          el(this.doc, 'span', { class: 'field-label', text: 'End date' }),
          this.endInput,
        ]),
      ]),
      el(this.doc, 'div', { class: 'field-row field-row-even' }, [
        blockedByField.element,
        relatedField.element,
      ]),
      el(this.doc, 'label', { class: 'field', attrs: { for: 'task-description' } }, [
        el(this.doc, 'span', { class: 'field-label', text: 'Description' }),
        this.descriptionInput,
      ]),
      this.errorLabel,
    );

    // The comments of the task, below the form.
    this.commentsElement = el(this.doc, 'div', { class: 'task-comments' });
    formChildren.push(this.commentsElement);
    this.renderComments();

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
      formChildren,
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

  /**
   * Draws the comments of the task, the most recent first.
   *
   * The section is only shown when the task already exists: a task that is
   * being created has no comment yet.
   */
  private renderComments(): void {
    const container = this.commentsElement;
    if (container === null) {
      return;
    }
    clear(container);

    const task = this.task;
    if (task === undefined) {
      return;
    }

    container.append(
      el(this.doc, 'div', { class: 'task-comments-header' }, [
        el(this.doc, 'span', { class: 'field-label', text: 'Comments' }),
        el(this.doc, 'span', {
          class: 'task-comments-count',
          text: String(this.comments.length),
        }),
      ]),
    );

    if (this.comments.length === 0) {
      container.append(
        el(this.doc, 'p', {
          class: 'task-comments-empty',
          text: 'This task has no comment yet.',
        }),
      );
    }

    for (const comment of this.comments) {
      container.append(this.renderComment(comment));
    }

    container.append(this.renderNewComment());
  }

  /** One comment of the list, with its actions. */
  private renderComment(comment: TaskComment): HTMLElement {
    const element = el(this.doc, 'article', { class: 'task-comment' });
    element.dataset['commentId'] = String(comment.id);

    const isEditing = this.editingCommentId === comment.id;

    const meta = el(this.doc, 'div', { class: 'task-comment-meta' }, [
      el(this.doc, 'span', {
        class: 'task-comment-date',
        text:
          comment.created.length > 0 ? formatTimestamp(comment.created) : `#${comment.id}`,
      }),
    ]);

    if (isEditing) {
      const editor = textArea(this.doc, {
        class: 'field-input task-comment-editor',
        value: comment.text,
        rows: 4,
      });
      meta.append(
        button(this.doc, 'Save', {
          class: 'primary small',
          onClick: () => {
            void this.saveComment(comment.id, editor.value);
          },
        }),
        button(this.doc, 'Cancel', {
          class: 'secondary small',
          onClick: () => {
            this.editingCommentId = null;
            this.renderComments();
          },
        }),
      );
      element.append(meta, editor);
      return element;
    }

    const actions = el(this.doc, 'div', { class: 'task-comment-actions' }, [
      button(this.doc, 'Edit', {
        class: 'secondary small',
        onClick: () => {
          this.editingCommentId = comment.id;
          this.renderComments();
        },
      }),
      button(this.doc, 'Delete', {
        class: 'danger small',
        onClick: () => {
          void this.removeComment(comment.id);
        },
      }),
    ]);

    element.append(
      meta,
      el(this.doc, 'div', { class: 'task-comment-text', text: comment.text }),
      actions,
    );
    return element;
  }

  /** The field that writes a new comment. */
  private renderNewComment(): HTMLElement {
    const editor = textArea(this.doc, {
      class: 'field-input task-comment-new',
      value: this.newCommentText,
      placeholder: 'Write a comment…',
      rows: 3,
    });
    editor.addEventListener('input', () => {
      this.newCommentText = editor.value;
    });

    return el(this.doc, 'div', { class: 'task-comment-new-row' }, [
      editor,
      button(this.doc, 'Add comment', {
        class: 'primary',
        onClick: () => {
          void this.addComment(editor.value);
        },
      }),
    ]);
  }

  /** Adds a comment to the task. */
  private async addComment(text: string): Promise<void> {
    const task = this.task;
    if (task === undefined || this.onAddComment === undefined) {
      return;
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      this.setError('The comment needs a text.');
      return;
    }
    try {
      await this.onAddComment(task.id, trimmed);
      this.newCommentText = '';
      await this.loadComments();
    } catch (error) {
      this.setError(error instanceof Error ? error.message : String(error));
    }
  }

  /** Changes the text of a comment. */
  private async saveComment(commentId: number, text: string): Promise<void> {
    const task = this.task;
    if (task === undefined || this.onUpdateComment === undefined) {
      return;
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      this.setError('The comment needs a text.');
      return;
    }
    try {
      await this.onUpdateComment(task.id, commentId, trimmed);
      this.editingCommentId = null;
      await this.loadComments();
    } catch (error) {
      this.setError(error instanceof Error ? error.message : String(error));
    }
  }

  /** Deletes a comment of the task. */
  private async removeComment(commentId: number): Promise<void> {
    const task = this.task;
    if (task === undefined || this.onDeleteComment === undefined) {
      return;
    }
    try {
      await this.onDeleteComment(task.id, commentId);
      if (this.editingCommentId === commentId) {
        this.editingCommentId = null;
      }
      await this.loadComments();
    } catch (error) {
      this.setError(error instanceof Error ? error.message : String(error));
    }
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

    const start = timestampFromDateInput(this.startInput?.value ?? '');
    const end = timestampFromDateInput(this.endInput?.value ?? '');
    if (start.length > 0 && end.length > 0 && end < start) {
      this.setError('The end date cannot be before the start date.');
      return;
    }

    const taskInput: TaskInput = {
      title,
      description: this.descriptionInput?.value ?? '',
      status,
      tags: normalizeTags(this.tagsInput?.value ?? ''),
      start,
      end,
      blockedBy: this.blockedByIds,
      related: this.relatedIds,
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
