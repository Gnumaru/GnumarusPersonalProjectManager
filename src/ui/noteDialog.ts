/**
 * Note editor: create, view, edit and delete a note.
 *
 * The body of a note is markdown. The editor shows it either as plain text
 * (the markdown source, in a text area) or rendered, and the user switches
 * from one to the other with the buttons of the editor.
 */

import { type Note, type NoteInput } from '../core/note.js';
import { button, clear, el, formatTimestamp, input, textArea } from './dom.js';
import { Modal } from './modal.js';
import { renderMarkdown } from './markdownView.js';

export type NoteDialogMode = 'view' | 'edit' | 'create';

export interface NoteDialogOptions {
  readonly doc: Document;
  readonly mode: NoteDialogMode;
  readonly note?: Note | undefined;
  readonly onSave: (input: NoteInput) => void | Promise<void>;
  readonly onDelete?: (() => void | Promise<void>) | undefined;
  /** Called when the user asks to switch from the read only view to the editor. */
  readonly onEdit?: (() => void) | undefined;
  readonly onCancel?: (() => void) | undefined;
}

/** The two ways the body of a note can be shown. */
type EditorMode = 'write' | 'preview';

export class NoteDialog {
  private readonly doc: Document;
  private readonly mode: NoteDialogMode;
  private readonly note: Note | undefined;
  private readonly onSave: (input: NoteInput) => void | Promise<void>;
  private readonly onDelete: (() => void | Promise<void>) | undefined;
  private readonly onEdit: (() => void) | undefined;
  private readonly onCancel: (() => void) | undefined;
  private readonly modal: Modal;

  private titleInput: HTMLInputElement | null = null;
  private contentInput: HTMLTextAreaElement | null = null;
  private previewElement: HTMLElement | null = null;
  private editorElement: HTMLElement | null = null;
  private errorLabel: HTMLDivElement | null = null;
  private confirmingDelete = false;

  constructor(options: NoteDialogOptions) {
    this.doc = options.doc;
    this.mode = options.mode;
    this.note = options.note;
    this.onSave = options.onSave;
    this.onDelete = options.onDelete;
    this.onEdit = options.onEdit;
    this.onCancel = options.onCancel;

    const title =
      options.mode === 'create'
        ? 'New note'
        : options.note !== undefined
          ? `Note #${options.note.id} - ${options.note.title}`
          : 'Note';
    this.modal = new Modal({ doc: this.doc, title, className: 'note-dialog' });
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
    if (this.mode === 'view') {
      this.renderView();
      return;
    }
    this.renderEditor();
  }

  /** The read only view: the note, rendered as markdown. */
  private renderView(): void {
    const note = this.note;
    const body: HTMLElement[] = [];

    if (note !== undefined) {
      body.push(
        el(this.doc, 'dl', { class: 'note-meta' }, [
          el(this.doc, 'dt', { text: 'Id' }),
          el(this.doc, 'dd', { text: String(note.id) }),
          el(this.doc, 'dt', { text: 'Created' }),
          el(this.doc, 'dd', { text: formatTimestamp(note.created) }),
          el(this.doc, 'dt', { text: 'Updated' }),
          el(this.doc, 'dd', { text: formatTimestamp(note.updated) }),
        ]),
      );
      body.push(renderMarkdown(this.doc, note.content));
    }

    this.modal.setBody(body);
    this.renderFooter();
  }

  /** The editor: the title and the body of the note. */
  private renderEditor(): void {
    const note = this.note;

    this.titleInput = input(this.doc, {
      class: 'field-input',
      id: 'note-title',
      value: note?.title ?? '',
      placeholder: 'The title of the note',
      onKeyDown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void this.save();
        }
      },
    });

    this.contentInput = textArea(this.doc, {
      class: 'note-content-input',
      id: 'note-content',
      value: note?.content ?? '',
      rows: 16,
      placeholder: 'The body of the note, in markdown…',
    });

    this.previewElement = el(this.doc, 'div', { class: 'note-preview' });
    this.editorElement = el(this.doc, 'div', { class: 'note-editor' }, [
      el(this.doc, 'label', { class: 'field', attrs: { for: 'note-content' } }, [
        el(this.doc, 'span', { class: 'field-label', text: 'Content (markdown)' }),
      ]),
      this.contentInput,
      this.previewElement,
    ]);

    this.errorLabel = el(this.doc, 'div', { class: 'form-error' });

    const writeButton = button(this.doc, 'Write', {
      class: 'secondary editor-mode-button',
      title: 'Edit the markdown source of the note',
      onClick: () => {
        this.setEditorMode('write');
      },
    });
    writeButton.dataset['editorMode'] = 'write';

    const previewButton = button(this.doc, 'Preview', {
      class: 'secondary editor-mode-button',
      title: 'Show the note as rendered markdown',
      onClick: () => {
        this.setEditorMode('preview');
      },
    });
    previewButton.dataset['editorMode'] = 'preview';

    this.modal.setBody([
      el(this.doc, 'label', { class: 'field', attrs: { for: 'note-title' } }, [
        el(this.doc, 'span', { class: 'field-label', text: 'Title' }),
        this.titleInput,
      ]),
      el(this.doc, 'div', { class: 'editor-mode-switch', attrs: { role: 'group' } }, [
        writeButton,
        previewButton,
      ]),
      this.editorElement,
      this.errorLabel,
    ]);

    this.renderFooter();
    this.setEditorMode('write');
  }

  /** The footer of the dialog: the delete button and the buttons of the action. */
  private renderFooter(): void {
    const children: HTMLElement[] = [];

    if (this.onDelete !== undefined) {
      children.push(
        el(this.doc, 'div', { class: 'dialog-footer-left' }, [
          this.confirmingDelete
            ? el(this.doc, 'div', { class: 'dialog-confirm' }, [
                el(this.doc, 'span', { text: 'Delete this note permanently?' }),
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
                    this.renderFooter();
                  },
                }),
              ])
            : button(this.doc, 'Delete', {
                class: 'danger',
                onClick: () => {
                  this.confirmingDelete = true;
                  this.renderFooter();
                },
              }),
        ]),
      );
    }

    const actions: HTMLElement[] = [];
    if (this.mode === 'view' && this.onEdit !== undefined) {
      actions.push(
        button(this.doc, 'Edit', {
          class: 'primary',
          onClick: () => {
            this.modal.close();
            this.onEdit?.();
          },
        }),
      );
    } else {
      actions.push(
        button(this.doc, 'Cancel', {
          class: 'secondary',
          onClick: () => {
            this.modal.close();
          },
        }),
      );
    }
    if (this.mode !== 'view') {
      actions.push(
        button(this.doc, this.mode === 'create' ? 'Create note' : 'Save changes', {
          class: 'primary',
          onClick: () => {
            void this.save();
          },
        }),
      );
    }
    children.push(el(this.doc, 'div', { class: 'dialog-footer-buttons' }, actions));

    this.modal.setFooter(children);
  }

  /** Deletes the note. */
  private async runDelete(): Promise<void> {
    if (this.onDelete === undefined) {
      return;
    }
    try {
      await this.onDelete();
      this.modal.close();
    } catch (error) {
      if (this.errorLabel !== null) {
        this.errorLabel.textContent = error instanceof Error ? error.message : String(error);
      }
    }
  }

  /** Shows the body either as plain text or as rendered markdown. */
  private setEditorMode(mode: EditorMode): void {
    const content = this.contentInput?.value ?? '';
    const writing = mode === 'write';

    if (this.contentInput !== null) {
      this.contentInput.toggleAttribute('hidden', !writing);
    }
    if (this.previewElement !== null) {
      this.previewElement.toggleAttribute('hidden', writing);
      clear(this.previewElement);
      if (!writing) {
        this.previewElement.append(renderMarkdown(this.doc, content));
      }
    }
    for (const node of this.modal.panel.querySelectorAll('.editor-mode-button')) {
      const active = node.getAttribute('data-editor-mode') === mode;
      node.classList.toggle('is-active', active);
      node.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  /** Saves the note. */
  private async save(): Promise<void> {
    const title = this.titleInput?.value.trim() ?? '';
    const content = this.contentInput?.value ?? '';
    if (title.length === 0) {
      if (this.errorLabel !== null) {
        this.errorLabel.textContent = 'The title of the note cannot be empty.';
      }
      return;
    }
    if (this.errorLabel !== null) {
      this.errorLabel.textContent = '';
    }
    try {
      await this.onSave({ title, content });
      this.modal.close();
    } catch (error) {
      if (this.errorLabel !== null) {
        this.errorLabel.textContent = error instanceof Error ? error.message : String(error);
      }
    }
  }
}
