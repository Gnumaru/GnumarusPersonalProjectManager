/**
 * The dialog of the project.
 *
 * It lets the user choose where the files of the project live:
 *
 * * in the **Gnumarus OS Bridge service**, on the disk of the machine;
 * * in an **embedded project**, in the browser (the Origin Private File
 *   System);
 * * in a folder of the disk, through the **File System Access API** (the
 *   Chromium based browsers only).
 *
 * An embedded project can be downloaded as a ZIP archive (the files are exactly
 * the ones that would be on the disk) and a ZIP archive can be imported, which
 * replaces the whole embedded project.
 */

import type { ProjectKind } from '../core/projectStore.js';
import { el } from './dom.js';
import { createIcon } from './icons.js';
import { Modal } from './modal.js';

export type ProjectDialogMode = ProjectKind;

export interface ProjectDialogOptions {
  readonly doc: Document;
  /** The mode the project uses now. */
  readonly mode: ProjectDialogMode;
  /** The folder of the project, `null` in the embedded mode. */
  readonly projectDir: string | null;
  /** The kind of storage the browser offers, for the messages. */
  readonly storageName?: string;
  /** The name of the folder of the project, in the File System Access mode. */
  readonly directoryName?: string | null;
  /** True when the browser offers the Origin Private File System. */
  readonly opfsAvailable?: boolean;
  /** True when the browser offers the File System Access API. */
  readonly fileSystemAvailable?: boolean;
  /** The user chooses the service. */
  readonly onUseService: () => void;
  /** The user chooses the embedded project. */
  readonly onUseEmbedded: () => void;
  /** The user chooses the File System Access API. */
  readonly onUseFileSystem?: (() => void) | undefined;
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
      false,
    );

    const opfsAvailable = options.opfsAvailable !== false;
    const embeddedButton = this.choiceButton(
      'An embedded project, in this browser',
      opfsAvailable
        ? `The files of the project are kept in the browser (${options.storageName ?? 'the storage of the browser'}). Only one embedded project can live in a browser: importing an archive replaces it completely.`
        : 'This browser does not offer the Origin Private File System, so the project cannot be kept in the browser.',
      options.mode === 'embedded',
      () => {
        options.onUseEmbedded();
      },
      !opfsAvailable,
    );

    const fileSystemAvailable = options.fileSystemAvailable === true;
    const directoryName = options.directoryName ?? null;
    const fileSystemButton = this.choiceButton(
      'File System Access API (Chromium based browsers only)',
      !fileSystemAvailable
        ? 'This browser does not offer the File System Access API: the files cannot be reached directly on the disk.'
        : directoryName === null
          ? 'The files of the project live in a folder of the disk, chosen by you with the picker of the browser. The application works without the low level service.'
          : `The files of the project live in the folder "${directoryName}" of the disk, reached with the File System Access API.`,
      options.mode === 'filesystem',
      () => {
        options.onUseFileSystem?.();
      },
      !fileSystemAvailable,
    );

    const body: HTMLElement[] = [
      el(doc, 'p', {
        class: 'dialog-help',
        text: 'Where should the files of the project be kept?',
      }),
      el(doc, 'div', { class: 'project-choices' }, [
        serviceButton,
        embeddedButton,
        fileSystemButton,
      ]),
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

    if (options.mode === 'filesystem') {
      body.push(
        el(doc, 'div', { class: 'project-folder' }, [
          el(doc, 'span', { class: 'field-label', text: 'Folder' }),
          el(doc, 'span', {
            class: 'project-folder-path',
            text: directoryName ?? 'No folder selected',
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

  /** One of the choices of the storage. */
  private choiceButton(
    title: string,
    description: string,
    isActive: boolean,
    onClick: () => void,
    disabled: boolean,
  ): HTMLElement {
    const button = el(this.doc, 'button', {
      class: `project-choice${isActive ? ' is-active' : ''}`,
      attrs: { type: 'button' },
      on: disabled
        ? {}
        : {
            click: () => {
              onClick();
            },
          },
    });
    button.toggleAttribute('disabled', disabled);
    if (disabled) {
      button.setAttribute('aria-disabled', 'true');
    }
    button.append(
      el(this.doc, 'span', { class: 'project-choice-title' }, [
        createIcon(this.doc, isActive ? 'check' : disabled ? 'warning' : 'file'),
        el(this.doc, 'span', { text: title }),
      ]),
      el(this.doc, 'span', { class: 'project-choice-description', text: description }),
    );
    return button;
  }
}
