/**
 * The dialog of the project.
 *
 * It lets the user choose where the files of the project live:
 *
 * * in the **Gnumarus OS Bridge service**, on the disk of the machine;
 * * in an **embedded project**, in the browser (the Origin Private File
 *   System);
 * * in a folder of the disk, through the **File System Access API** (the
 *   Chromium based browsers only);
 * * in a **Supabase** database, reached with its project URL and API key.
 *
 * An embedded project can be downloaded as a ZIP archive (the files are exactly
 * the ones that would be on the disk) and a ZIP archive can be imported, which
 * replaces the whole embedded project.
 */

import { SUPABASE_SETUP_SQL, SupabaseClient, normalizeSupabaseUrl, verifySupabaseSchema } from '../api/supabase.js';
import type { ProjectKind } from '../core/projectStore.js';
import { el, input } from './dom.js';
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
  /** The Supabase project URL kept in the browser, if any. */
  readonly supabaseUrl?: string | null;
  /** The Supabase API key kept in the browser, if any. */
  readonly supabaseKey?: string | null;
  /** The `fetch` used to talk to Supabase; defaults to the global one. */
  readonly supabaseFetch?: typeof fetch | undefined;
  /** The user chooses Supabase with tested credentials. */
  readonly onUseSupabase?: ((url: string, key: string) => void) | undefined;
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
  /** Whether the Supabase credential form is shown. */
  private supabaseExpanded: boolean;
  private supabaseUrlValue: string;
  private supabaseKeyValue: string;
  private supabaseUrlInput: HTMLInputElement | null = null;
  private supabaseKeyInput: HTMLInputElement | null = null;
  private supabaseError: HTMLElement | null = null;
  private supabaseSetup: HTMLElement | null = null;
  private supabaseSetupDetail: HTMLElement | null = null;
  private supabaseSetupSql: HTMLTextAreaElement | null = null;
  private supabaseStatus: HTMLElement | null = null;

  constructor(options: ProjectDialogOptions) {
    this.doc = options.doc;
    this.options = options;
    this.supabaseExpanded = options.mode === 'supabase';
    this.supabaseUrlValue = options.supabaseUrl ?? '';
    this.supabaseKeyValue = options.supabaseKey ?? '';

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

    const supabaseButton = this.choiceButton(
      'Supabase (PostgreSQL in the cloud)',
      'The files of the project live in a Supabase database, reached with its project URL and API key. The database is tested before it is used.',
      options.mode === 'supabase',
      () => {
        this.supabaseExpanded = true;
        this.modal.setBody([this.buildBody()]);
      },
      false,
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
        supabaseButton,
      ]),
    ];

    if (this.supabaseExpanded) {
      body.push(this.buildSupabaseSection());
    }

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

  /** The Supabase credential form with the connection test. */
  private buildSupabaseSection(): HTMLElement {
    const doc = this.doc;

    this.supabaseUrlInput = input(doc, {
      class: 'field-input',
      id: 'supabase-url',
      value: this.supabaseUrlValue,
      placeholder: 'https://xyz.supabase.co',
      onKeyDown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void this.connectSupabase();
        }
      },
    });
    this.supabaseUrlInput.addEventListener('input', () => {
      this.supabaseUrlValue = this.supabaseUrlInput?.value ?? '';
    });
    this.supabaseKeyInput = input(doc, {
      class: 'field-input',
      id: 'supabase-key',
      type: 'password',
      value: this.supabaseKeyValue,
      placeholder: 'The anon or service_role API key',
      onKeyDown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void this.connectSupabase();
        }
      },
    });
    this.supabaseKeyInput.addEventListener('input', () => {
      this.supabaseKeyValue = this.supabaseKeyInput?.value ?? '';
    });

    this.supabaseError = el(doc, 'div', { class: 'form-error' });
    this.supabaseStatus = el(doc, 'p', { class: 'supabase-status', attrs: { hidden: 'hidden' } });

    this.supabaseSetupDetail = el(doc, 'p', { class: 'dialog-help' });
    this.supabaseSetupSql = doc.createElement('textarea');
    this.supabaseSetupSql.className = 'field-input supabase-setup-sql';
    this.supabaseSetupSql.readOnly = true;
    this.supabaseSetupSql.value = SUPABASE_SETUP_SQL;
    this.supabaseSetupSql.setAttribute('aria-label', 'Queries to create the Supabase tables');
    const selectAll = el(doc, 'button', {
      class: 'secondary small',
      text: 'Select all',
      attrs: { type: 'button' },
      on: {
        click: () => {
          this.supabaseSetupSql?.focus();
          this.supabaseSetupSql?.select();
        },
      },
    });
    this.supabaseSetup = el(
      doc,
      'div',
      { class: 'supabase-setup', attrs: { hidden: 'hidden' } },
      [
        el(doc, 'span', { class: 'field-label', text: 'Create the tables' }),
        this.supabaseSetupDetail,
        this.supabaseSetupSql,
        selectAll,
      ],
    );

    const connect = el(doc, 'button', {
      class: 'primary',
      text: 'Connect',
      attrs: { type: 'button' },
      on: {
        click: () => {
          void this.connectSupabase();
        },
      },
    });

    return el(doc, 'div', { class: 'supabase-form' }, [
      el(doc, 'span', { class: 'field-label', text: 'Supabase' }),
      el(doc, 'p', {
        class: 'dialog-help',
        text: 'Type the project URL and the API key of the Supabase project. The database is tested before it is used.',
      }),
      el(doc, 'label', { class: 'field', attrs: { for: 'supabase-url' } }, [
        el(doc, 'span', { class: 'field-label', text: 'Project URL' }),
        this.supabaseUrlInput,
      ]),
      el(doc, 'label', { class: 'field', attrs: { for: 'supabase-key' } }, [
        el(doc, 'span', { class: 'field-label', text: 'API key' }),
        this.supabaseKeyInput,
      ]),
      this.supabaseError,
      this.supabaseStatus,
      this.supabaseSetup,
      el(doc, 'div', { class: 'dialog-footer-buttons' }, [connect]),
    ]);
  }

  /** Tests the Supabase database and uses it when it is as expected. */
  private async connectSupabase(): Promise<void> {
    const url = this.supabaseUrlInput?.value.trim() ?? this.supabaseUrlValue.trim();
    const key = (this.supabaseKeyInput?.value ?? this.supabaseKeyValue).trim();
    this.supabaseUrlValue = url;
    this.supabaseKeyValue = key;
    if (this.supabaseError !== null) {
      this.supabaseError.textContent = '';
    }
    this.hideSupabaseSetup();
    if (this.supabaseStatus !== null) {
      this.supabaseStatus.setAttribute('hidden', 'hidden');
    }
    if (url.length === 0 || key.length === 0) {
      if (this.supabaseError !== null) {
        this.supabaseError.textContent = 'The project URL and the API key are both needed.';
      }
      return;
    }
    let normalized: string;
    try {
      normalized = normalizeSupabaseUrl(url);
    } catch (error) {
      if (this.supabaseError !== null) {
        this.supabaseError.textContent = error instanceof Error ? error.message : String(error);
      }
      return;
    }
    const client = new SupabaseClient({
      url: normalized,
      key,
      fetchImpl: this.options.supabaseFetch,
    });
    const check = await verifySupabaseSchema(client).catch((error: unknown) => ({
      ok: false as const,
      issue: {
        kind: 'unreachable' as const,
        detail: error instanceof Error ? error.message : String(error),
      },
    }));
    if (check.ok) {
      if (this.supabaseStatus !== null) {
        this.supabaseStatus.textContent = 'The database is as expected: the Supabase project is used now.';
        this.supabaseStatus.removeAttribute('hidden');
      }
      this.options.onUseSupabase?.(normalized, key);
      return;
    }
    if (check.issue.kind === 'invalid-credentials') {
      if (this.supabaseError !== null) {
        this.supabaseError.textContent = `The Supabase credentials were rejected (${check.issue.detail}). Check the URL and the key and try again.`;
      }
      return;
    }
    if (check.issue.kind === 'missing-table' || check.issue.kind === 'wrong-format') {
      if (this.supabaseError !== null) {
        this.supabaseError.textContent = check.issue.detail;
      }
      this.showSupabaseSetup(
        'Run these queries once in the SQL editor of the Supabase project, then press Connect again.',
      );
      return;
    }
    if (check.issue.kind === 'access-denied') {
      if (this.supabaseError !== null) {
        this.supabaseError.textContent = check.issue.detail;
      }
      this.showSupabaseSetup(
        'The key cannot use the tables. Run these queries, then press Connect again.',
      );
      return;
    }
    if (this.supabaseError !== null) {
      this.supabaseError.textContent = check.issue.detail;
    }
  }

  /** Shows the queries that create the Supabase tables. */
  private showSupabaseSetup(detail: string): void {
    if (this.supabaseSetupDetail !== null) {
      this.supabaseSetupDetail.textContent = detail;
    }
    this.supabaseSetup?.removeAttribute('hidden');
  }

  /** Hides the queries that create the Supabase tables. */
  private hideSupabaseSetup(): void {
    this.supabaseSetup?.setAttribute('hidden', 'hidden');
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
