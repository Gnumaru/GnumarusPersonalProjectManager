/**
 * OS like file/directory picker.
 *
 * It browses the real file system through the low level operations service and
 * offers the usual navigation: back, forward, up, root, drives, home, manual
 * path entry and folder creation.
 */

import { ApiClient, ApiError, type DirectoryEntry } from '../api/client.js';
import { button, clear, el, input, shellQuote } from './dom.js';
import { createIcon } from './icons.js';
import { Modal } from './modal.js';

export type FileDialogMode = 'directory' | 'file';

export interface FileDialogOptions {
  readonly doc: Document;
  readonly api: ApiClient;
  readonly mode: FileDialogMode;
  readonly title?: string;
  /** Extensions that can be selected, e.g. `['.txt']`. Only used in `file` mode. */
  readonly filters?: readonly string[];
  readonly onSelect: (path: string) => void;
  readonly onCancel?: () => void;
}

const USER_DIRECTORY_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['XDG_DESKTOP_DIR', 'Desktop'],
  ['XDG_DOCUMENTS_DIR', 'Documents'],
  ['XDG_DOWNLOAD_DIR', 'Downloads'],
  ['XDG_PICTURES_DIR', 'Pictures'],
];

export class FileDialog {
  private readonly doc: Document;
  private readonly api: ApiClient;
  private readonly mode: FileDialogMode;
  private readonly filters: readonly string[];
  private readonly onSelect: (path: string) => void;
  private readonly onCancel: (() => void) | undefined;
  private readonly modal: Modal;

  private currentPath = '/';
  private selected: string | null = null;
  private entries: DirectoryEntry[] = [];
  private history: string[] = [];
  private historyIndex = -1;
  private homeDirectory = '~';
  private mountPoints: string[] = ['/'];
  private userDirectories: { readonly label: string; readonly path: string }[] = [];

  private readonly listElement: HTMLDivElement;
  private readonly placesElement: HTMLDivElement;
  private readonly pathInput: HTMLInputElement;
  private readonly selectionLabel: HTMLSpanElement;
  private readonly backButton: HTMLButtonElement;
  private readonly forwardButton: HTMLButtonElement;
  private readonly upButton: HTMLButtonElement;

  constructor(options: FileDialogOptions) {
    this.doc = options.doc;
    this.api = options.api;
    this.mode = options.mode;
    this.filters = options.filters ?? [];
    this.onSelect = options.onSelect;
    this.onCancel = options.onCancel;

    const title = options.title ?? (this.mode === 'directory' ? 'Select a folder' : 'Select a file');
    this.modal = new Modal({ doc: this.doc, title, className: 'file-dialog' });

    this.backButton = this.iconButton('back', 'Back', () => {
      this.goBack();
    });
    this.forwardButton = this.iconButton('forward', 'Forward', () => {
      this.goForward();
    });
    this.upButton = this.iconButton('up', 'Parent folder', () => {
      this.goUp();
    });
    const refreshButton = this.iconButton('refresh', 'Refresh', () => {
      void this.navigateTo(this.currentPath, false);
    });

    this.pathInput = input(this.doc, {
      class: 'path-input',
      value: this.currentPath,
      placeholder: '/path/to/folder',
      onKeyDown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void this.navigateTo(this.pathInput.value.trim(), true);
        }
      },
    });

    const goButton = button(this.doc, 'Go', {
      class: 'secondary',
      onClick: () => {
        void this.navigateTo(this.pathInput.value.trim(), true);
      },
    });

    const newFolderButton = button(this.doc, 'New folder', {
      class: 'secondary',
      onClick: () => {
        this.showNewFolderRow();
      },
    });

    const toolbar = el(this.doc, 'div', { class: 'fd-toolbar' }, [
      el(this.doc, 'div', { class: 'fd-nav-buttons' }, [
        this.backButton,
        this.forwardButton,
        this.upButton,
        refreshButton,
      ]),
      el(this.doc, 'div', { class: 'fd-path-row' }, [this.pathInput, goButton, newFolderButton]),
    ]);

    this.listElement = el(this.doc, 'div', { class: 'fd-list' });
    this.placesElement = el(this.doc, 'div', { class: 'fd-places' });

    const body = el(this.doc, 'div', { class: 'fd-body' }, [
      el(this.doc, 'aside', { class: 'fd-sidebar' }, [this.placesElement]),
      el(this.doc, 'div', { class: 'fd-content' }, [this.listElement]),
    ]);

    this.selectionLabel = el(this.doc, 'span', { class: 'fd-selection', text: 'No selection' });

    const cancelButton = button(this.doc, 'Cancel', {
      class: 'secondary',
      onClick: () => {
        this.modal.close();
      },
    });
    const confirmButton = button(this.doc, this.mode === 'directory' ? 'Use this folder' : 'Open', {
      class: 'primary',
      onClick: () => {
        this.confirm();
      },
    });

    this.modal.setBody([toolbar, body]);
    this.modal.setFooter([
      el(this.doc, 'div', { class: 'fd-footer-left' }, [this.selectionLabel]),
      el(this.doc, 'div', { class: 'fd-footer-buttons' }, [cancelButton, confirmButton]),
    ]);
    this.modal.onClose(() => {
      this.doc.removeEventListener('keydown', this.handleDialogKeyDown, true);
      this.onCancel?.();
    });
  }

  /** Opens the dialog, starting at the given path when possible. */
  async open(startPath?: string): Promise<void> {
    this.modal.open();
    this.doc.addEventListener('keydown', this.handleDialogKeyDown, true);
    await this.loadPlaces();
    const initial = startPath ?? this.homeDirectory;
    const opened = await this.navigateTo(initial, true);
    if (!opened) {
      // The requested folder does not exist (any more): start at the home folder.
      await this.navigateTo(this.homeDirectory, true);
    }
  }

  /**
   * Enters the selected directory when the user presses `Enter`.
   *
   * The key is listened to on the whole document, so the folder is entered
   * whatever has the focus. The cases that already have a meaning come first:
   *
   * * a row of the list enters the folder it shows;
   * * the path box goes to the path that was typed in it;
   * * any other text field (the name of the new folder) handles the key.
   *
   * When nothing else applies, the selected directory is entered.
   */
  private readonly handleDialogKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') {
      return;
    }
    const target = event.target;
    if (hasAncestorWithClass(target, 'fd-entry')) {
      return;
    }
    if (target === this.pathInput && this.pathInput.value.trim() !== this.currentPath) {
      return;
    }
    if (isTextEntry(target) || isButton(target)) {
      return;
    }
    const selected = this.selected;
    if (selected === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (isDirectoryEntry(this.entries, selected)) {
      void this.navigateTo(selected, true);
      return;
    }
    if (this.mode === 'file') {
      this.confirm();
    }
  };

  private iconButton(icon: string, title: string, onClick: () => void): HTMLButtonElement {
    const node = button(this.doc, '', {
      class: 'icon-button',
      title,
      onClick,
    });
    node.append(createIcon(this.doc, icon));
    return node;
  }

  private async loadPlaces(): Promise<void> {
    try {
      this.homeDirectory = await this.api.homeDirectory();
    } catch {
      this.homeDirectory = '~';
    }
    try {
      this.mountPoints = await this.api.listMountPoints();
    } catch {
      this.mountPoints = ['/'];
    }
    await this.loadUserDirectories();
    this.renderPlaces();
  }

  private async loadUserDirectories(): Promise<void> {
    this.userDirectories = [];
    try {
      const file = await this.api.readFile('~/.config/user-dirs.dirs');
      const lines = file.content.split('\n');
      for (const [key, fallbackName] of USER_DIRECTORY_KEYS) {
        const line = lines.find((candidate) => candidate.startsWith(`${key}="`));
        if (line === undefined) {
          continue;
        }
        const raw = line.slice(`${key}="`.length).replace(/"\s*$/u, '');
        const path = raw.replace('$HOME', this.homeDirectory);
        if (path.length === 0) {
          continue;
        }
        this.userDirectories.push({ label: fallbackName, path });
      }
    } catch {
      // The file is optional.
    }
  }

  private renderPlaces(): void {
    clear(this.placesElement);

    const section = (label: string, items: readonly { label: string; path: string }[]): void => {
      if (items.length === 0) {
        return;
      }
      this.placesElement.append(
        el(this.doc, 'div', { class: 'fd-places-title', text: label }),
      );
      for (const item of items) {
        const entry = el(
          this.doc,
          'button',
          {
            class: `fd-place${item.path === this.currentPath ? ' fd-place-active' : ''}`,
            attrs: { type: 'button' },
            on: {
              click: () => {
                void this.navigateTo(item.path, true);
              },
            },
          },
          [createIcon(this.doc, 'folder'), el(this.doc, 'span', { text: item.label })],
        );
        this.placesElement.append(entry);
      }
    };

    section('Places', [
      { label: 'Home', path: this.homeDirectory },
      { label: 'File system', path: '/' },
      ...this.userDirectories.map((item) => ({ label: item.label, path: item.path })),
    ]);

    section(
      'Drives',
      this.mountPoints.map((mountPoint) => ({
        label: mountPoint,
        path: mountPoint,
      })),
    );
  }

  private async navigateTo(path: string, pushHistory: boolean): Promise<boolean> {
    const target = path.length > 0 ? path : '/';
    this.setBusy(true);
    try {
      const entries = await this.api.readDirectory(target);
      this.currentPath = target;
      this.entries = entries;
      this.selected = null;
      this.pathInput.value = target;
      if (pushHistory) {
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push(target);
        this.historyIndex = this.history.length - 1;
      }
      this.updateNavigationButtons();
      this.renderPlaces();
      this.renderList();
      this.updateSelectionLabel();
      return true;
    } catch (error) {
      this.renderError(error);
      return false;
    } finally {
      this.setBusy(false);
    }
  }

  private goBack(): void {
    if (this.historyIndex <= 0) {
      return;
    }
    this.historyIndex -= 1;
    const target = this.history[this.historyIndex];
    if (target !== undefined) {
      void this.navigateTo(target, false);
    }
  }

  private goForward(): void {
    if (this.historyIndex >= this.history.length - 1) {
      return;
    }
    this.historyIndex += 1;
    const target = this.history[this.historyIndex];
    if (target !== undefined) {
      void this.navigateTo(target, false);
    }
  }

  private goUp(): void {
    const parent = parentDirectory(this.currentPath);
    if (parent !== null && parent !== this.currentPath) {
      void this.navigateTo(parent, true);
    }
  }

  private updateNavigationButtons(): void {
    this.backButton.disabled = this.historyIndex <= 0;
    this.forwardButton.disabled = this.historyIndex >= this.history.length - 1;
    this.upButton.disabled = parentDirectory(this.currentPath) === null;
  }

  private renderList(): void {
    clear(this.listElement);

    const directories = this.entries
      .filter((entry) => entry.type === 'dir')
      .sort(compareEntries);
    const files = this.entries
      .filter((entry) => entry.type !== 'dir')
      .sort(compareEntries);
    const visibleFiles = files.filter((entry) => this.matchesFilter(entry.name));

    if (directories.length === 0 && visibleFiles.length === 0) {
      this.listElement.append(
        el(this.doc, 'div', { class: 'fd-empty', text: 'This folder is empty.' }),
      );
      return;
    }

    for (const entry of directories) {
      this.listElement.append(this.renderEntry(entry, true));
    }
    if (visibleFiles.length > 0) {
      if (directories.length > 0) {
        this.listElement.append(el(this.doc, 'div', { class: 'fd-separator', text: 'Files' }));
      }
      for (const entry of visibleFiles) {
        this.listElement.append(this.renderEntry(entry, false));
      }
    }
  }

  private renderEntry(entry: DirectoryEntry, isDirectory: boolean): HTMLElement {
    const row = el(this.doc, 'div', {
      class: `fd-entry${this.selected === entry.path ? ' fd-entry-selected' : ''}`,
      attrs: { tabindex: '0', role: 'button', 'aria-label': entry.name },
      dataset: { path: entry.path },
      on: {
        click: () => {
          this.select(entry.path);
        },
        dblclick: () => {
          if (isDirectory) {
            void this.navigateTo(entry.path, true);
          } else if (this.mode === 'file') {
            this.confirm();
          }
        },
        keydown: (event) => {
          const keyboardEvent = event as KeyboardEvent;
          if (keyboardEvent.key === 'Enter') {
            keyboardEvent.preventDefault();
            if (isDirectory) {
              void this.navigateTo(entry.path, true);
            } else {
              this.confirm();
            }
          }
        },
      },
    });

    row.append(createIcon(this.doc, isDirectory ? 'folder' : 'file'));
    row.append(el(this.doc, 'span', { class: 'fd-entry-name', text: entry.name }));
    if (!isDirectory && entry.size > 0) {
      row.append(el(this.doc, 'span', { class: 'fd-entry-size', text: formatSize(entry.size) }));
    }
    return row;
  }

  private matchesFilter(name: string): boolean {
    if (this.mode !== 'file' || this.filters.length === 0) {
      return true;
    }
    const lower = name.toLowerCase();
    return this.filters.some((filter) => lower.endsWith(filter.toLowerCase()));
  }

  /**
   * Selects an entry of the list.
   *
   * The list is **not** rebuilt: emptying it would bring the scroll back to the
   * top and it would become impossible to enter a folder with a double click.
   * Only the class of the rows is updated.
   */
  private select(path: string): void {
    this.selected = path;
    this.updateSelectedRows();
    this.updateSelectionLabel();
  }

  /** Marks the row of the selected entry, leaving the rest of the list alone. */
  private updateSelectedRows(): void {
    for (const row of this.listElement.querySelectorAll<HTMLElement>('.fd-entry')) {
      row.classList.toggle('fd-entry-selected', row.dataset['path'] === this.selected);
    }
  }

  private updateSelectionLabel(): void {
    this.selectionLabel.textContent =
      this.selected === null ? 'No selection' : this.selected;
  }

  private showNewFolderRow(): void {
    const existing = this.listElement.querySelector('.fd-new-folder');
    if (existing !== null) {
      return;
    }
    const nameInput = input(this.doc, {
      class: 'fd-new-folder-input',
      placeholder: 'Folder name',
      onKeyDown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void this.createFolder(nameInput.value);
        }
        if (event.key === 'Escape') {
          row.remove();
        }
      },
    });
    const createButton = button(this.doc, 'Create', {
      class: 'primary small',
      onClick: () => {
        void this.createFolder(nameInput.value);
      },
    });
    const cancelButton = button(this.doc, 'Cancel', {
      class: 'secondary small',
      onClick: () => {
        row.remove();
      },
    });
    const row = el(this.doc, 'div', { class: 'fd-new-folder' }, [
      createIcon(this.doc, 'folder'),
      nameInput,
      createButton,
      cancelButton,
    ]);
    this.listElement.prepend(row);
    nameInput.focus();
  }

  private async createFolder(name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return;
    }
    const target = `${this.currentPath.replace(/\/+$/u, '')}/${trimmed}`;
    try {
      await this.api.execShell({
        command: `mkdir -p -- ${shellQuote(target)}`,
        timeout: 15,
      });
      await this.navigateTo(target, true);
    } catch (error) {
      this.renderError(error);
    }
  }

  private renderError(error: unknown): void {
    clear(this.listElement);
    const message = error instanceof ApiError ? error.message : String(error);
    this.listElement.append(el(this.doc, 'div', { class: 'fd-error', text: message }));
  }

  private setBusy(busy: boolean): void {
    this.listElement.classList.toggle('fd-busy', busy);
  }

  private confirm(): void {
    if (this.mode === 'directory') {
      const selected = this.selected;
      const target =
        selected !== null && isDirectoryEntry(this.entries, selected) ? selected : this.currentPath;
      this.modal.close();
      this.onSelect(target);
      return;
    }

    const selected = this.selected;
    if (selected === null) {
      return;
    }
    if (!this.matchesFilter(selected.slice(selected.lastIndexOf('/') + 1))) {
      return;
    }
    this.modal.close();
    this.onSelect(selected);
  }
}

function isDirectoryEntry(entries: readonly DirectoryEntry[], path: string): boolean {
  return entries.some((entry) => entry.path === path && entry.type === 'dir');
}

/** Name of the tag of an event target, in upper case. */
function tagNameOf(target: EventTarget | null): string {
  if (target === null || typeof target !== 'object') {
    return '';
  }
  const tagName = (target as { tagName?: unknown }).tagName;
  return typeof tagName === 'string' ? tagName.toUpperCase() : '';
}

/** True when the event target is a text entry. */
function isTextEntry(target: EventTarget | null): boolean {
  const name = tagNameOf(target);
  return name === 'INPUT' || name === 'TEXTAREA' || name === 'SELECT';
}

/** True when the event target is a button: it handles `Enter` by itself. */
function isButton(target: EventTarget | null): boolean {
  return tagNameOf(target) === 'BUTTON';
}

/** True when the event target is inside an element with the given class. */
function hasAncestorWithClass(target: EventTarget | null, className: string): boolean {
  let current: unknown = target;
  while (current !== null && typeof current === 'object') {
    const element = current as {
      classList?: { contains(value: string): boolean };
      parentNode?: unknown;
    };
    if (element.classList?.contains(className) === true) {
      return true;
    }
    current = element.parentNode;
  }
  return false;
}

/** Sorts the entries of the file list in a natural, case insensitive order. */
export function compareEntries(left: DirectoryEntry, right: DirectoryEntry): number {
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
}

/** Parent directory of a path, `null` for the root. */
export function parentDirectory(path: string): string | null {
  if (path.length === 0 || path === '/') {
    return null;
  }
  const trimmed = path.replace(/\/+$/u, '');
  const index = trimmed.lastIndexOf('/');
  if (index <= 0) {
    return '/';
  }
  return trimmed.slice(0, index);
}

/** Human readable file size. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex] ?? 'KB'}`;
}
