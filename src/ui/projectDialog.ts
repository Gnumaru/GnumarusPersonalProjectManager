/**
 * The dialog of the project.
 *
 * It lets the user choose where the files of the project live:
 *
 * * in the **Gnumarus OS Bridge service**, on the disk of the machine;
 * * in an **embedded project**, in the browser.
 *
 * An embedded project can be downloaded as a ZIP archive (the files are exactly
 * the ones that would be on the disk) and a ZIP archive can be imported, which
 * replaces the whole embedded project.
 */

import { el } from './dom.js';
import { createIcon } from './icons.js';
import { Modal } from './modal.js';

export type ProjectDialogMode = 'service' | 'embedded';

export interface ProjectDialogOptions {
  readonly doc: Document;
  /** The mode the project uses now. */
  readonly mode: ProjectDialogMode;
  /** The folder of the project, `null` in the embedded mode. */
  readonly projectDir: string | null;
  /** The kind of storage the browser offers, for the messages. */
  readonly storageName?: string;
  /** The user chooses the service. */
  readonly onUseService: () => void;
  /** The user chooses the embedded project. */
  readonly onUseEmbedded: () => void;
  /** The user asks for the folder of the project. */
  readonly onChooseFolder: () => void;
  /** The user asks for the ZIP archive of the project. */
  readonly onDownload: () => void;
  /** The user asks for the import of a ZIP archive. */
  readonly onImport: (file: File) => void;
}

export class ProjectDialog {
  private readonly doc: Document;
  private readonly options: ProjectDialogOptions;
  private readonly modal: Modal;
  private readonly fileInput: HTMLInputElement;

  constructor(options: ProjectDialogOptions) {
    this.doc = options.doc;
    this.options = options;

    this.modal = new Modal({ doc: options.doc, title: 'The project', className: 'project-dialog' });

    this.fileInput = this.doc.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.zip,application/zip';
    this.fileInput.className = 'project-file-input';
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      if (file !== undefined) {
        options.onImport(file);
      }
      this.fileInput.value = '';
    });

    this.modal.setBody([this.buildBody()]);
    this.modal.setFooter([
      el(options.doc, 'div', { class: 'dialog-footer-buttons' }, [
        el(options.doc, 'button', {
          class: 'secondary',
          text: 'Close',
          attrs: { type: 'button' },
          on: {
            click: () => {
              this.modal.close();
            },
          },
        }),
      ]),
    ]);
  }

  /** Opens the dialog. */
  open(): void {
    this.modal.open();
  }

  private buildBody(): HTMLElement {
    const doc = this.doc;
    const options = this.options;

    const serviceButton = this.choiceButton(
      'The Gnumarus OS Bridge service',
      'The files of the project live on the disk of the machine, reached through the low level service.',
      options.mode === 'service',
      () => {
        options.onUseService();
      },
    );

    const embeddedButton = this.choiceButton(
      'An embedded project, in this browser',
      `The files of the project are kept in the browser (${options.storageName ?? 'the storage of the browser'}). Only one embedded project can live in a browser: importing an archive replaces it completely.`,
      options.mode === 'embedded',
      () => {
        options.onUseEmbedded();
      },
    );

    const body: HTMLElement[] = [
      el(doc, 'p', {
        class: 'dialog-help',
        text: 'Where should the files of the project be kept?',
      }),
      el(doc, 'div', { class: 'project-choices' }, [serviceButton, embeddedButton]),
    ];

    if (options.mode === 'service') {
      body.push(
        el(doc, 'div', { class: 'project-folder' }, [
          el(doc, 'span', { class: 'field-label', text: 'Folder' }),
          el(doc, 'span', {
            class: 'project-folder-path',
            text: options.projectDir ?? 'No folder selected',
          }),
          el(doc, 'button', {
            class: 'secondary',
            text: 'Choose folder…',
            attrs: { type: 'button' },
            on: {
              click: () => {
                options.onChooseFolder();
              },
            },
          }),
        ]),
      );
    }

    body.push(
      el(doc, 'div', { class: 'project-archive' }, [
        el(doc, 'div', { class: 'project-archive-header' }, [
          el(doc, 'span', { class: 'field-label', text: 'ZIP archive' }),
        ]),
        el(doc, 'p', {
          class: 'dialog-help',
          text: 'The archive holds the files of the project, exactly as they would be on the disk.',
        }),
        el(doc, 'div', { class: 'project-archive-actions' }, [
          el(doc, 'button', {
            class: 'secondary',
            text: 'Download the project',
            attrs: { type: 'button' },
            on: {
              click: () => {
                options.onDownload();
              },
            },
          }),
          el(doc, 'button', {
            class: 'secondary',
            text: 'Import an archive',
            attrs: { type: 'button' },
            on: {
              click: () => {
                this.fileInput.click();
              },
            },
          }),
        ]),
        this.fileInput,
      ]),
    );

    return el(doc, 'div', { class: 'project-dialog-body' }, body);
  }

  /** One of the two choices of the storage. */
  private choiceButton(
    title: string,
    description: string,
    isActive: boolean,
    onClick: () => void,
  ): HTMLElement {
    const button = el(this.doc, 'button', {
      class: `project-choice${isActive ? ' is-active' : ''}`,
      attrs: { type: 'button' },
      on: {
        click: () => {
          onClick();
        },
      },
    });
    button.append(
      el(this.doc, 'span', { class: 'project-choice-title' }, [
        createIcon(this.doc, isActive ? 'check' : 'file'),
        el(this.doc, 'span', { text: title }),
      ]),
      el(this.doc, 'span', { class: 'project-choice-description', text: description }),
    );
    return button;
  }
}
