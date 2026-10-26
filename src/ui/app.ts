/**
 * Application controller.
 *
 * Wires the user interface to the low level operations service: it keeps the
 * state (selected folder, search term, current page), loads the tasks of the
 * current page and exposes the create/edit/view/delete actions.
 *
 * Two display modes are available: the flat **list** of the tasks (paginated)
 * and the **tree** of the tasks, where every task can be collapsed, expanded
 * and focused.
 */

import { ApiClient, ApiError, ApiUnavailableError } from '../api/client.js';
import {
  loadConfig,
  readMode,
  saveConfig,
  writeMode,
  clampNotePageSize,
  type AppConfig,
  type ConfigStorage,
} from '../core/config.js';
import { DEFAULT_PAGE_SIZE, computePageInfo, type PageInfo } from '../core/pagination.js';
import { createBrowserFileStorage, supportsOpfs } from '../core/browserStorage.js';
import { EmbeddedProjectStore } from '../core/embeddedStore.js';
import { ServiceProjectStore } from '../core/serviceStore.js';
import { FileSystemProjectStore } from '../core/fileSystemStore.js';
import {
  checkPermission,
  createDirectoryHandleStorage,
  pickProjectDirectory,
  requestPermission,
  supportsFileSystemAccess,
  type DirectoryHandle,
  type DirectoryHandleStorage,
} from '../core/fileSystemAccess.js';
import type { NoteSummary, ProjectStore, TaskHierarchy, TaskSummary } from '../core/projectStore.js';
import {
  nextSortState,
  sortRows,
  type SortState,
  type SortType,
} from '../core/tableSort.js';
import { commentFileName, type TaskComment } from '../core/comment.js';
import {
  NOTE_SCOPE_LABELS,
  NOTE_SEARCH_SCOPES,
  applyNoteInput,
  buildNote,
  type Note,
  type NoteInput,
  type NoteSearchScope,
} from '../core/note.js';
import { createZip, readZip } from '../core/zip.js';
import {
  ancestorsOf,
  buildTaskTree,
  flattenTaskTree,
  parentOf,
  subtreeOf,
  type TaskTree,
  type TreeRow,
} from '../core/taskTree.js';
import {
  barOf,
  buildLayout,
  buildPaddedSchedule,
  dayOfIndex,
  dayOfTimestamp,
  daysBetween,
  isoDate,
  startOfMonth,
  type GanttLayout,
  type GanttSchedule,
} from '../core/gantt.js';
import {
  STATUS_LABELS,
  applyTaskInput,
  buildTask,
  formatTaskTimestamp,
  parseTaskIdFromFileName,
  withDates,
  withDefaultDates,
  withExpandedState,
  withParent,
  withStatus,
  type Task,
  type TaskCard,
  type TaskInput,
  type TaskStatus,
} from '../core/task.js';
import { button, clear, el, input, select, type Child } from './dom.js';
import { FileDialog } from './fileDialog.js';
import { renderGanttView, type GanttTask } from './ganttView.js';
import { GanttDragController, type GanttDragContext } from './ganttDrag.js';
import { createIcon } from './icons.js';
import { KanbanDragController } from './kanbanDrag.js';
import { renderKanbanBoard } from './kanbanBoard.js';
import { Modal } from './modal.js';
import { NoteDialog } from './noteDialog.js';
import { renderNoteRows } from './noteTable.js';
import { ProjectDialog } from './projectDialog.js';
import { renderPaginationBar } from './paginationBar.js';
import { TaskDialog } from './taskDialog.js';
import { renderTaskRows } from './taskTable.js';
import { renderTreeRows } from './taskTreeView.js';
import { TreeDragController, ROOT_TARGET_CLASS } from './treeDrag.js';
import { showToast } from './toast.js';

export const TOKEN_STORAGE_KEY = 'gnumarus-project-manager.token';

/**
 * Minimal storage contract used to persist the API token.
 *
 * `window.localStorage` satisfies it; keeping the contract small avoids
 * depending on the whole `Storage` interface.
 */
export interface TokenStorage extends ConfigStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type ServiceState = 'checking' | 'online' | 'offline' | 'unauthorized';

/** The five ways the project can be displayed. */
export type ViewMode = 'list' | 'tree' | 'kanban' | 'gantt' | 'notes';

export interface AppOptions {
  readonly doc: Document;
  readonly root: HTMLElement;
  readonly api?: ApiClient;
  readonly storage?: TokenStorage;
  readonly tokenStorageKey?: string;
  /** Where the handle of the folder of the project is kept. */
  readonly handleStorage?: DirectoryHandleStorage;
}

const SERVICE_CHECK_INTERVAL_MS = 5000;

/** Amount of task files read at the same time when the tree is drawn. */
const TREE_READ_CONCURRENCY = 8;

/** The columns of the flat list of the tasks that can be sorted. */
const TASK_SORT_FIELDS: Readonly<
  Record<string, { readonly type: SortType; readonly value: (task: TaskSummary) => number | string | null }>
> = {
  id: { type: 'number', value: (task) => task.id },
  title: { type: 'string', value: (task) => task.title.toLowerCase() },
  parent: { type: 'number', value: (task) => task.parentId },
  status: { type: 'string', value: (task) => STATUS_LABELS[task.status] },
  updated: { type: 'date', value: (task) => task.updated },
};

/** The columns of the listing of the notes that can be sorted. */
const NOTE_SORT_FIELDS: Readonly<
  Record<string, { readonly type: SortType; readonly value: (note: NoteSummary) => number | string | null }>
> = {
  id: { type: 'number', value: (note) => note.id },
  title: { type: 'string', value: (note) => note.title.toLowerCase() },
  updated: { type: 'date', value: (note) => note.updated },
};

export class App
 {
  private readonly doc: Document;
  private readonly root: HTMLElement;
  private readonly api: ApiClient;
  private readonly storage: TokenStorage | undefined;
  private readonly tokenStorageKey: string;
  /** Where the handle of the folder of the project is kept. */
  private readonly handleStorage: DirectoryHandleStorage;
  /** The handle of the folder of the project, `null` when there is none. */
  private fileSystemHandle: DirectoryHandle | null = null;
  /** The state of the permission of the browser on the folder. */
  private fileSystemPermission: PermissionState = 'prompt';
  /** The name of the folder of the project. */
  private fileSystemDirectoryName: string | null = null;

  private token: string | null = null;
  /**
   * Whether the service demands a token.
   *
   * `false` when the service was started without the token requirement: the
   * application then works without a token and never asks the user for one.
   * `null` when the policy could not be determined.
   */
  private authRequired: boolean | null = null;
  private config: AppConfig = {
    mode: 'service',
    projectDir: null,
    pageSize: DEFAULT_PAGE_SIZE,
    notePageSize: 10,
  };
  /**
   * The storage of the project.
   *
   * `null` when there is no project yet: the service mode needs a folder and
   * the embedded mode needs the storage of the browser.
   */
  private store: ProjectStore | null = null;
  private query = '';
  private page = 1;
  private pageSize = DEFAULT_PAGE_SIZE;
  private tasks: Task[] = [];
  private info: PageInfo = computePageInfo(1, DEFAULT_PAGE_SIZE, 0);
  private childCounts = new Map<number, number>();
  /** The amount of comments of every task. */
  private commentCounts = new Map<number, number>();
  private serviceState: ServiceState = 'checking';

  /** The notes of the displayed page. */
  private notes: Note[] = [];
  /** The pagination of the notes. */
  private notePage = 1;
  private notePageSize = 10;
  private noteInfo: PageInfo = computePageInfo(1, 10, 0);
  /** What the search of the notes looks at. */
  private noteScope: NoteSearchScope = 'both';

  /** The display mode currently in use. */
  private viewMode: ViewMode = 'list';
  /** The task the tree is focused on, `null` for the general root. */
  private treeFocusId: number | null = null;
  /** The tasks whose children are shown in the tree. */
  private treeExpanded = new Set<number>();
  /** The rows of the tree currently displayed. */
  private treeRows: TreeRow[] = [];
  /** The tasks of the displayed rows, indexed by their id. */
  private treeTasks = new Map<number, Task>();
  /** The structure of the tasks, read from the disk. */
  private treeHierarchy: TaskHierarchy | null = null;
  /** The tree built from the hierarchy. */
  private treeStructure: TaskTree | null = null;
  /** The tasks matching the current search, `null` when there is no search. */
  private treeMatches: Set<number> | null = null;
  /** The sort of the flat list of the tasks. */
  private taskSort: SortState | null = null;
  /** The sort of the listing of the notes. */
  private noteSort: SortState | null = null;
  /** The header row of the task table, rebuilt on every render. */
  private taskTableHead!: HTMLElement;
  /** The header row of the note table, rebuilt on every render. */
  private noteTableHead!: HTMLElement;
  /** The cards of the board: the tasks that have no child. */
  private kanbanCards: TaskCard[] = [];
  /** The metadata of the tasks, read for the Gantt chart. */
  private ganttMetadata = new Map<number, TaskSummary>();
  /** The weeks and the months that are collapsed in the Gantt chart. */
  private ganttCollapsed = new Set<string>();
  /** The schedule of the chart currently drawn. */
  private ganttScheduleState: GanttSchedule | null = null;
  /** The columns of the chart currently drawn. */
  private ganttLayoutState: GanttLayout | null = null;

  private projectPathElement!: HTMLElement;
  private chooseFolderButton!: HTMLButtonElement;
  private serviceTextElement!: HTMLElement;
  private servicePillElement!: HTMLElement;
  private tokenButton!: HTMLButtonElement;
  private bannerElement!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private clearSearchButton!: HTMLButtonElement;
  private newTaskButton!: HTMLButtonElement;
  private listViewButton!: HTMLButtonElement;
  private treeViewButton!: HTMLButtonElement;
  private kanbanViewButton!: HTMLButtonElement;
  private ganttViewButton!: HTMLButtonElement;
  private notesViewButton!: HTMLButtonElement;
  private noteScopeSelect!: HTMLSelectElement;
  private tableWrapElement!: HTMLElement;
  private treeWrapElement!: HTMLElement;
  private treeHeaderElement!: HTMLElement;
  private treeRowsElement!: HTMLElement;
  private kanbanElement!: HTMLElement;
  private ganttElement!: HTMLElement;
  /** The left edge of the columns of the chart, for the drag of the bars. */
  private ganttChartOriginElement: HTMLElement | null = null;
  private ganttDrag: GanttDragController | null = null;
  private treeDrag: TreeDragController | null = null;
  private kanbanDrag: KanbanDragController | null = null;
  private notesWrapElement!: HTMLElement;
  private rowsElement!: HTMLTableSectionElement;
  private noteRowsElement!: HTMLTableSectionElement;
  private emptyStateElement!: HTMLElement;
  private paginationElement!: HTMLElement;
  private resultCountElement!: HTMLElement;

  private checkTimer: number | null = null;

  constructor(options: AppOptions) {
    this.doc = options.doc;
    this.root = options.root;
    this.api = options.api ?? new ApiClient();
    this.storage = options.storage;
    this.tokenStorageKey = options.tokenStorageKey ?? TOKEN_STORAGE_KEY;
    this.handleStorage = options.handleStorage ?? createDirectoryHandleStorage();
  }

  /** The window of the page, `null` when there is none. */
  private window(): Window | null {
    return this.doc.defaultView;
  }

  /** Stops the background service watcher. */
  dispose(): void {
    if (this.checkTimer !== null) {
      this.doc.defaultView?.clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    this.doc.removeEventListener('keydown', this.handleGlobalKeyDown);
  }

  /** Boots the application. */
  async start(): Promise<void> {
    this.buildLayout();
    this.updateViewToggle();
    this.token = this.readStoredToken();
    this.api.setToken(this.token);

    // The kind of storage is known before the service is checked: the service
    // is not needed at all when the project lives in the browser.
    this.config = { ...this.config, mode: readMode(this.storage, this.window()) };

    this.setServiceState('checking');
    await this.checkService();

    await this.loadConfig();
    await this.openStore();
    // The path of the project can be known only once the store is open: the
    // name of the folder comes from the handle of the browser.
    this.updateProjectPath();
    await this.refresh();

    this.startServiceWatch();
    this.doc.addEventListener('keydown', this.handleGlobalKeyDown);
  }

  /**
   * Opens the storage of the project.
   *
   * The service mode needs a folder, the embedded mode needs the storage of the
   * browser: when one of them is missing the application waits for the user.
   */
  private async openStore(): Promise<void> {
    const config = this.config;
    if (config.mode === 'filesystem') {
      await this.openFileSystemStore();
      return;
    }
    if (config.mode === 'embedded') {
      try {
        const storage = await createBrowserFileStorage(this.window());
        this.storageName = storage.name;
        const store = new EmbeddedProjectStore(storage);
        await store.load();
        this.store = store;
        if (!storage.persistent) {
          showToast({
            doc: this.doc,
            message:
              'This browser cannot keep the project: download the ZIP archive to keep it.',
            kind: 'error',
          });
        }
      } catch (error) {
        this.store = null;
        showToast({
          doc: this.doc,
          message: `Unable to open the storage of the browser: ${
            error instanceof Error ? error.message : String(error)
          }`,
          kind: 'error',
        });
      }
      return;
    }
    if (config.projectDir === null) {
      this.store = null;
      return;
    }
    this.store = new ServiceProjectStore(this.api, config.projectDir);
  }

  /**
   * Opens the folder of the project, reached with the File System Access API.
   *
   * The handle of the folder is kept between two visits, but the permission
   * is not: the browser asks the user again, and the application offers a
   * button to give the access back.
   */
  private async openFileSystemStore(): Promise<void> {
    const handle = await this.handleStorage.read();
    if (handle === null) {
      this.fileSystemHandle = null;
      this.fileSystemDirectoryName = null;
      this.fileSystemPermission = 'prompt';
      this.store = null;
      return;
    }
    this.fileSystemHandle = handle;
    this.fileSystemDirectoryName = handle.name;
    this.fileSystemPermission = await checkPermission(handle);
    if (this.fileSystemPermission !== 'granted') {
      this.store = null;
      return;
    }
    this.store = new FileSystemProjectStore(handle);
  }

  // ---------------------------------------------------------------- layout --

  private buildLayout(): void {
    clear(this.root);

    this.projectPathElement = el(this.doc, 'span', {
      class: 'project-path',
      text: 'No folder selected',
      title: '',
    });
    const chooseFolderButton = button(this.doc, 'Choose folder…', {
      class: 'secondary',
      onClick: () => {
        void this.openFolderPicker();
      },
    });
    this.chooseFolderButton = chooseFolderButton;

    const projectButton = button(this.doc, 'Project…', {
      class: 'secondary',
      title: 'Choose where the files of the project are kept',
      onClick: () => {
        this.openProjectDialog();
      },
    });
    projectButton.append(createIcon(this.doc, 'folder'));

    this.serviceTextElement = el(this.doc, 'span', { class: 'service-text', text: 'Checking…' });
    this.servicePillElement = el(this.doc, 'div', { class: 'service-pill' }, [
      el(this.doc, 'span', { class: 'service-dot' }),
      this.serviceTextElement,
    ]);

    this.tokenButton = button(this.doc, 'API token', {
      class: 'secondary',
      title: 'Token used to talk to the Gnumarus OS Bridge service',
      onClick: () => {
        this.openTokenDialog();
      },
    });
    this.tokenButton.append(createIcon(this.doc, 'pencil'));

    const refreshButton = button(this.doc, 'Refresh', {
      class: 'secondary',
      onClick: () => {
        void this.refresh();
      },
    });
    refreshButton.append(createIcon(this.doc, 'refresh'));

    const topbar = el(this.doc, 'header', { class: 'topbar' }, [
      el(this.doc, 'div', { class: 'brand' }, [
        el(this.doc, 'span', { class: 'brand-mark', text: 'GP' }),
        el(this.doc, 'div', { class: 'brand-text' }, [
          el(this.doc, 'h1', { text: 'Gnumarus Project Manager' }),
          el(this.doc, 'p', { text: 'Tasks stored as plain text files' }),
        ]),
      ]),
      el(this.doc, 'div', { class: 'topbar-project' }, [
        el(this.doc, 'span', { class: 'topbar-label', text: 'Project folder' }),
        this.projectPathElement,
        chooseFolderButton,
        projectButton,
      ]),
      el(this.doc, 'div', { class: 'topbar-actions' }, [
        this.servicePillElement,
        this.tokenButton,
        refreshButton,
      ]),
    ]);

    this.bannerElement = el(this.doc, 'div', { class: 'banner', attrs: { hidden: 'hidden' } });

    this.searchInput = input(this.doc, {
      class: 'search-input',
      id: 'search-input',
      placeholder: 'Search tasks by title, tag or description…',
      onKeyDown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.applySearch(this.searchInput.value);
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          this.applySearch('');
        }
      },
    });

    // The scope of the search of the notes: the title, the content or both.
    this.noteScopeSelect = select(this.doc, {
      class: 'search-scope',
      id: 'note-scope',
      value: 'both',
      options: [
        { value: 'both', label: NOTE_SCOPE_LABELS.both },
        { value: 'title', label: NOTE_SCOPE_LABELS.title },
        { value: 'content', label: NOTE_SCOPE_LABELS.content },
      ],
      onChange: (value) => {
        this.setNoteScope(value);
      },
    });
    this.noteScopeSelect.setAttribute('hidden', 'hidden');
    this.noteScopeSelect.title = 'What the search of the notes looks at';

    const searchButton = button(this.doc, 'Search', {
      class: 'primary',
      onClick: () => {
        this.applySearch(this.searchInput.value);
      },
    });
    searchButton.append(createIcon(this.doc, 'search'));

    this.clearSearchButton = button(this.doc, 'Clear', {
      class: 'secondary',
      title: 'Clear the search',
      onClick: () => {
        this.applySearch('');
      },
    });

    this.resultCountElement = el(this.doc, 'span', { class: 'result-count' });

    this.newTaskButton = button(this.doc, 'New task', {
      class: 'primary',
      onClick: () => {
        this.openCreateFromToolbar();
      },
    });
    this.newTaskButton.append(createIcon(this.doc, 'plus'));

    this.listViewButton = button(this.doc, 'List', {
      class: 'view-toggle-button is-active',
      title: 'Show the tasks as a flat list',
      onClick: () => {
        void this.setViewMode('list');
      },
    });
    this.listViewButton.dataset['viewMode'] = 'list';

    this.treeViewButton = button(this.doc, 'Tree', {
      class: 'view-toggle-button',
      title: 'Show the tasks as a tree',
      onClick: () => {
        void this.setViewMode('tree');
      },
    });
    this.treeViewButton.dataset['viewMode'] = 'tree';

    this.kanbanViewButton = button(this.doc, 'Kanban', {
      class: 'view-toggle-button',
      title: 'Show the tasks as a board of columns, one per status',
      onClick: () => {
        void this.setViewMode('kanban');
      },
    });
    this.kanbanViewButton.dataset['viewMode'] = 'kanban';

    this.ganttViewButton = button(this.doc, 'Gantt', {
      class: 'view-toggle-button',
      title: 'Show the tasks as a Gantt chart of their start and end dates',
      onClick: () => {
        void this.setViewMode('gantt');
      },
    });
    this.ganttViewButton.dataset['viewMode'] = 'gantt';

    this.notesViewButton = button(this.doc, 'Notes', {
      class: 'view-toggle-button',
      title: 'Show the notes of the project',
      onClick: () => {
        void this.setViewMode('notes');
      },
    });
    this.notesViewButton.dataset['viewMode'] = 'notes';

    const viewToggle = el(
      this.doc,
      'div',
      { class: 'view-toggle', attrs: { role: 'group', 'aria-label': 'The way the project is displayed' } },
      [
        this.listViewButton,
        this.treeViewButton,
        this.kanbanViewButton,
        this.ganttViewButton,
        this.notesViewButton,
      ],
    );

    const toolbar = el(this.doc, 'div', { class: 'toolbar' }, [
      el(this.doc, 'div', { class: 'search-box' }, [
        this.searchInput,
        this.noteScopeSelect,
        searchButton,
        this.clearSearchButton,
      ]),
      el(this.doc, 'div', { class: 'toolbar-right' }, [
        viewToggle,
        this.resultCountElement,
        this.newTaskButton,
      ]),
    ]);

    this.rowsElement = this.doc.createElement('tbody');
    this.taskTableHead = this.doc.createElement('thead');
    this.emptyStateElement = el(this.doc, 'div', { class: 'empty-state', attrs: { hidden: 'hidden' } });

    const table = el(this.doc, 'table', { class: 'task-table' }, [
      this.taskTableHead,
      this.rowsElement,
    ]);

    this.tableWrapElement = el(this.doc, 'div', { class: 'table-wrap' }, [table]);

    this.noteRowsElement = this.doc.createElement('tbody');
    this.noteTableHead = this.doc.createElement('thead');
    const noteTable = el(this.doc, 'table', { class: 'note-table' }, [
      this.noteTableHead,
      this.noteRowsElement,
    ]);
    this.notesWrapElement = el(
      this.doc,
      'div',
      { class: 'table-wrap notes-wrap', attrs: { hidden: 'hidden' } },
      [noteTable],
    );

    this.treeHeaderElement = el(this.doc, 'div', { class: 'tree-header' });
    this.treeRowsElement = el(this.doc, 'div', { class: 'tree-rows' });
    this.treeWrapElement = el(this.doc, 'div', { class: 'tree-wrap', attrs: { hidden: 'hidden' } }, [
      this.treeHeaderElement,
      this.treeRowsElement,
    ]);

    this.treeDrag?.dispose();
    this.treeDrag = new TreeDragController({
      doc: this.doc,
      container: this.treeRowsElement,
      onDrop: (draggedId, targetId) => {
        void this.reparentTask(draggedId, targetId);
      },
      onDetach: (draggedId) => {
        void this.reparentTask(draggedId, null);
      },
    });

    this.kanbanElement = el(this.doc, 'div', { class: 'kanban-wrap', attrs: { hidden: 'hidden' } });
    this.kanbanDrag?.dispose();
    this.kanbanDrag = new KanbanDragController({
      doc: this.doc,
      container: this.kanbanElement,
      onDrop: (taskId, status) => {
        void this.changeTaskStatus(taskId, status);
      },
    });

    this.ganttElement = el(this.doc, 'div', { class: 'gantt-container', attrs: { hidden: 'hidden' } });
    this.ganttDrag?.dispose();
    this.ganttDrag = new GanttDragController({
      doc: this.doc,
      container: this.ganttElement,
      context: () => this.ganttDragContext(),
      onChange: (taskId, start, end) => {
        void this.changeTaskDates(taskId, start, end);
      },
    });

    const content = el(this.doc, 'main', { class: 'content' }, [
      this.tableWrapElement,
      this.notesWrapElement,
      this.treeWrapElement,
      this.kanbanElement,
      this.ganttElement,
      this.emptyStateElement,
    ]);

    this.paginationElement = el(this.doc, 'footer', { class: 'pagination-footer' });

    this.root.append(topbar, this.bannerElement, toolbar, content, this.paginationElement);
    this.updateToolbarForMode();
  }

  // -------------------------------------------------------------- service --

  private async checkService(): Promise<void> {
    if (this.config.mode !== 'service') {
      // The project lives in the browser: the service is not used at all.
      this.updateAuthUi();
      this.setServiceState('online');
      return;
    }
    const status = await this.api.fetchServiceStatus();
    if (!status.available) {
      this.setServiceState('offline');
      return;
    }
    const cameBack = this.serviceState === 'offline';
    this.authRequired = status.authRequired;
    this.updateAuthUi();
    if (cameBack) {
      // The service came back: reload everything.
      showToast({ doc: this.doc, message: 'The Gnumarus OS Bridge service is back online.', kind: 'success' });
      await this.loadConfig();
      await this.refresh();
      return;
    }
    this.setServiceState('online');
  }

  /**
   * Adapts the interface to the authentication policy of the service.
   *
   * When the service does not demand a token the **API token** button is
   * hidden: there is nothing for the user to type. The tooltip of the status
   * pill always describes the current policy.
   */
  private updateAuthUi(): void {
    // The projects that live in the browser never talk to the service: the
    // token would be useless.
    const tokenIsUseless = this.authRequired === false || this.config.mode !== 'service';
    this.tokenButton.toggleAttribute('hidden', tokenIsUseless);
    this.servicePillElement.title =
      this.config.mode !== 'service'
        ? 'The project lives in the browser: the service is not used.'
        : this.authRequired === false
          ? 'The service accepts every request without an API token.'
          : this.authRequired === true
            ? 'The service requires an API token.'
            : 'The authentication policy of the service is unknown.';
  }

  private startServiceWatch(): void {
    if (this.checkTimer !== null) {
      return;
    }
    const view = this.doc.defaultView;
    if (view === null) {
      return;
    }
    this.checkTimer = view.setInterval(() => {
      void this.checkService();
    }, SERVICE_CHECK_INTERVAL_MS);
  }

  private setServiceState(state: ServiceState): void {
    this.serviceState = state;
    this.servicePillElement.classList.remove('state-checking', 'state-online', 'state-offline', 'state-unauthorized');
    this.servicePillElement.classList.add(`state-${state}`);

    const labels: Readonly<Record<ServiceState, string>> = {
      checking: 'Checking…',
      online: 'Service online',
      offline: 'Service unavailable',
      unauthorized: 'Invalid token',
    };
    if (this.config.mode !== 'service') {
      // The project lives in the browser: the service is never used.
      this.serviceTextElement.textContent = 'Service not needed';
      this.servicePillElement.classList.remove(
        'state-checking',
        'state-offline',
        'state-unauthorized',
      );
      this.servicePillElement.classList.add('state-online');
      this.hideBanner();
      return;
    }
    this.serviceTextElement.textContent = labels[state];

    if (state === 'offline') {
      if (this.config.mode === 'service') {
        this.showBanner(
          'The Gnumarus OS Bridge service is not reachable. The application retries automatically every few seconds.',
          'error',
        );
      } else {
        // The project lives in the browser: the service is not needed.
        this.hideBanner();
      }
    } else if (state === 'unauthorized') {
      this.showBanner(
        'The API token was rejected by the Gnumarus OS Bridge service. Open the token dialog and paste the current token.',
        'error',
      );
    } else {
      this.hideBanner();
    }
  }

  private showBanner(message: string, kind: 'info' | 'error'): void {
    clear(this.bannerElement);
    this.bannerElement.className = `banner banner-${kind}`;
    this.bannerElement.removeAttribute('hidden');
    this.bannerElement.append(
      el(this.doc, 'span', { class: 'banner-text', text: message }),
      button(this.doc, 'Retry now', {
        class: 'secondary small',
        onClick: () => {
          void this.checkService();
        },
      }),
    );
  }

  private hideBanner(): void {
    this.bannerElement.setAttribute('hidden', 'hidden');
    clear(this.bannerElement);
  }

  // --------------------------------------------------------------- config --

  private async loadConfig(): Promise<void> {
    const mode = readMode(this.storage, this.window());
    this.config = await loadConfig(this.api, mode, this.storage);
    this.config = { ...this.config, mode };
    this.pageSize = this.config.pageSize;
    this.notePageSize = this.config.notePageSize;
    this.updateProjectPath();
  }

  private async persistConfig(): Promise<void> {
    try {
      await saveConfig(
        this.api,
        {
          mode: this.config.mode,
          projectDir: this.config.projectDir,
          pageSize: this.pageSize,
          notePageSize: this.notePageSize,
        },
        this.storage,
      );
    } catch (error) {
      showToast({
        doc: this.doc,
        message: `Unable to save the configuration: ${error instanceof Error ? error.message : String(error)}`,
        kind: 'error',
      });
    }
  }

  private updateProjectPath(): void {
    const projectDir = this.config.projectDir;
    if (this.config.mode === 'embedded') {
      const storage = this.storageName;
      this.projectPathElement.textContent =
        storage === null ? 'Embedded project' : `Embedded project (${storage})`;
      this.projectPathElement.title =
        storage === null
          ? 'The files of the project are kept in this browser.'
          : `The files of the project are kept in this browser, at the root of the ${storage}.`;
      this.chooseFolderButton.setAttribute('hidden', 'hidden');
      return;
    }
    this.chooseFolderButton.removeAttribute('hidden');
    if (this.config.mode === 'filesystem') {
      const name = this.fileSystemDirectoryName;
      this.projectPathElement.textContent = name ?? 'No folder selected';
      this.projectPathElement.title =
        name === null
          ? 'Choose the folder of the project with the picker of the browser.'
          : `The files of the project live in the folder "${name}" of the disk.`;
      return;
    }
    if (projectDir === null) {
      this.projectPathElement.textContent = 'No folder selected';
      this.projectPathElement.title = '';
      return;
    }
    this.projectPathElement.textContent = shortenPath(projectDir, 52);
    this.projectPathElement.title = projectDir;
  }

  // -------------------------------------------------------------- project --

  /** Opens the dialog that chooses where the files of the project are kept. */
  private openProjectDialog(): void {
    const dialog = new ProjectDialog({
      doc: this.doc,
      mode: this.config.mode,
      projectDir: this.config.projectDir,
      storageName: this.storageName,
      directoryName: this.fileSystemDirectoryName,
      opfsAvailable: supportsOpfs(this.window()),
      fileSystemAvailable: supportsFileSystemAccess(this.window()),
      onUseService: () => {
        void this.switchToService();
      },
      onUseEmbedded: () => {
        void this.switchToEmbedded();
      },
      onUseFileSystem: () => {
        void this.switchToFileSystem();
      },
      onChooseFolder: () => {
        void this.openFolderPicker();
      },
      onDownload: () => {
        void this.downloadProjectArchive();
      },
      onImport: (file) => {
        void this.importProjectArchive(file);
      },
    });
    dialog.open();
  }

  /** The name of the storage the browser offers, for the messages. */
  private storageName = 'the storage of the browser';

  /**
   * Works on the files of the machine, reached through the service.
   *
   * The embedded project is **not** touched: the user can go back to it.
   */
  private async switchToService(): Promise<void> {
    writeMode('service', this.storage);
    // The folder of the project of the service lives in the configuration file
    // of the machine: it is read again when the memory does not hold it, so
    // the folder that was chosen before is restored.
    if (this.config.projectDir === null) {
      const stored = await loadConfig(this.api, 'service', this.storage);
      if (stored.projectDir !== null) {
        this.config = { ...this.config, projectDir: stored.projectDir };
      }
    }
    this.config = { ...this.config, mode: 'service' };
    await this.persistConfig();
    await this.openStore();
    this.updateProjectPath();
    await this.refresh();
  }

  /**
   * Works on the project that lives in the browser.
   *
   * The embedded project is the only one the browser can hold: when the user
   * imports an archive, the current one is discarded completely.
   */
  private async switchToEmbedded(): Promise<void> {
    writeMode('embedded', this.storage);
    // The embedded project has no folder of its own: its files live at the
    // root of the storage of the browser. The folder of the service is kept
    // in the memory, so the user finds it again when it comes back.
    this.config = { ...this.config, mode: 'embedded' };
    await this.persistConfig();
    await this.openStore();
    this.updateProjectPath();
    await this.refresh();
  }

  /**
   * Works on a folder of the disk, reached with the File System Access API.
   *
   * The picker of the browser is shown right away: the user chooses the
   * folder that will hold the files of the project.
   */
  private async switchToFileSystem(): Promise<void> {
    const picked = await this.pickFileSystemDirectory();
    if (!picked) {
      // The user closed the picker: nothing changes.
      return;
    }
    writeMode('filesystem', this.storage);
    // The folder of the project is the one of the picker of the browser: the
    // folder of the service is kept in the memory, so the user finds it again
    // when it comes back.
    this.config = { ...this.config, mode: 'filesystem' };
    await this.persistConfig();
    await this.openStore();
    this.updateProjectPath();
    await this.refresh();
  }

  /**
   * Shows the picker of the browser and keeps the handle of the folder.
   *
   * `false` when the user closes the picker without choosing anything.
   */
  private async pickFileSystemDirectory(): Promise<boolean> {
    const handle = await pickProjectDirectory(this.window());
    if (handle === null) {
      return false;
    }
    await this.handleStorage.write(handle);
    return true;
  }

  /**
   * Asks the browser for the access to the folder of the project.
   *
   * The browser only allows it when the user clicks the button.
   */
  private async grantFileSystemAccess(): Promise<void> {
    const handle = this.fileSystemHandle;
    if (handle === null) {
      return;
    }
    const state = await requestPermission(handle);
    this.fileSystemPermission = state;
    if (state !== 'granted') {
      showToast({
        doc: this.doc,
        message: 'The browser did not give the access to the folder of the project.',
        kind: 'error',
      });
      return;
    }
    await this.openStore();
    this.updateProjectPath();
    await this.refresh();
  }

  /** Downloads the files of the project as a ZIP archive. */
  private async downloadProjectArchive(): Promise<void> {
    const store = this.store;
    if (store === null) {
      showToast({
        doc: this.doc,
        message: 'There is no project to download yet.',
        kind: 'error',
      });
      return;
    }
    try {
      const files = await store.listFiles();
      const archive = createZip(files);
      const blob = new Blob([archive.slice().buffer], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const link = this.doc.createElement('a');
      link.href = url;
      link.download = 'project.zip';
      this.doc.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast({
        doc: this.doc,
        message: `The project was downloaded (${files.length} files).`,
        kind: 'success',
      });
    } catch (error) {
      showToast({
        doc: this.doc,
        message: `Unable to download the project: ${error instanceof Error ? error.message : String(error)}`,
        kind: 'error',
      });
    }
  }

  /**
   * Imports a ZIP archive as the embedded project.
   *
   * The files of the current embedded project are discarded completely. When
   * the project lives in a folder of the disk, the archive replaces the files
   * of that folder instead.
   */
  private async importProjectArchive(file: File): Promise<void> {
    try {
      const buffer = await file.arrayBuffer();
      const files = readZip(new Uint8Array(buffer));

      if (this.config.mode === 'filesystem' && this.store !== null) {
        // The files of the folder of the project are replaced.
        await this.store.replaceAll(files);
        await this.refresh();
        showToast({
          doc: this.doc,
          message: `The archive was imported (${files.length} files).`,
          kind: 'success',
        });
        return;
      }

      writeMode('embedded', this.storage);
      this.config = { ...this.config, mode: 'embedded' };
      const storage = await createBrowserFileStorage(this.window());
      this.storageName = storage.name;
      const store = new EmbeddedProjectStore(storage);
      await store.replaceAll(files);
      await this.persistConfig();
      this.store = store;
      this.page = 1;
      this.query = '';
      this.searchInput.value = '';
      this.updateProjectPath();
      await this.refresh();
      showToast({
        doc: this.doc,
        message: `The archive was imported (${files.length} files).`,
        kind: 'success',
      });
    } catch (error) {
      showToast({
        doc: this.doc,
        message: `Unable to import the archive: ${error instanceof Error ? error.message : String(error)}`,
        kind: 'error',
      });
    }
  }

  // ---------------------------------------------------------------- tasks --

  private async refresh(): Promise<void> {
    if (this.store === null) {
      this.tasks = [];
      this.info = computePageInfo(1, this.pageSize, 0);
      this.treeRows = [];
      this.treeTasks = new Map<number, Task>();
      this.renderCurrentView();
      return;
    }

    this.setBusy(true);
    try {
      if (this.viewMode === 'tree') {
        await this.refreshTree();
      } else if (this.viewMode === 'kanban') {
        await this.refreshKanban();
      } else if (this.viewMode === 'gantt') {
        await this.refreshGantt();
      } else if (this.viewMode === 'notes') {
        await this.refreshNotes();
      } else {
        await this.refreshList();
      }
      if (this.config.mode === 'service') {
        // The projects that live in the browser never talk to the service.
        this.setServiceState('online');
      }
      this.renderCurrentView();
    } catch (error) {
      this.handleError(error);
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * Loads one page of the notes.
   *
   * Only the files of the page are read: the memory holds the notes that are
   * on the screen and nothing else.
   */
  /**
   * Renders the header of the task table.
   *
   * Every sortable column carries a button: clicking it sorts the table by the
   * column, descending at first, and inverts the direction on the next clicks
   * of the same column. The tags and the actions are not sortable.
   */
  private renderTaskTableHead(): void {
    clear(this.taskTableHead);
    this.taskTableHead.append(
      el(this.doc, 'tr', {}, [
        this.sortHeader('cell-id', 'ID', 'id', 'task'),
        this.sortHeader('cell-title', 'Title', 'title', 'task'),
        this.sortHeader('cell-parent', 'Parent', 'parent', 'task'),
        el(this.doc, 'th', { class: 'cell-tags', text: 'Tags' }),
        this.sortHeader('cell-status', 'Status', 'status', 'task'),
        this.sortHeader('cell-updated', 'Updated', 'updated', 'task'),
        el(this.doc, 'th', { class: 'cell-actions' }),
      ]),
    );
  }

  /** The header of each notes table cell. */
  private renderNoteTableHead(): void {
    clear(this.noteTableHead);
    this.noteTableHead.append(
      el(this.doc, 'tr', {}, [
        this.sortHeader('cell-id', 'ID', 'id', 'note'),
        this.sortHeader('cell-title', 'Title', 'title', 'note'),
        this.sortHeader('cell-updated', 'Updated', 'updated', 'note'),
        el(this.doc, 'th', { class: 'cell-actions' }),
      ]),
    );
  }

  /**
   * One sortable header cell of the two tables.
   *
   * The active sort column shows its direction (descending ▼ or ascending ▲);
   * the other sortable columns show a small indicator that they can be
   * clicked.
   */
  private sortHeader(
    cssClass: string,
    label: string,
    field: string,
    table: 'task' | 'note',
  ): HTMLElement {
    const state = table === 'task' ? this.taskSort : this.noteSort;
    const active = state?.field === field;
    const text = active
      ? `${label} ${state?.direction === 'asc' ? '▲' : '▼'}`
      : `${label} ↕`;
    const header = el(this.doc, 'button', {
      class: 'th-sort',
      text,
      attrs: {
        title: active
          ? `Sorted ${state?.direction === 'asc' ? 'ascending' : 'descending'}: click to invert`
          : `Sort by ${label.toLowerCase()}`,
      },
    });
    header.addEventListener('click', () => {
      if (table === 'task') {
        this.taskSort = nextSortState(this.taskSort, field);
        this.page = 1;
      } else {
        this.noteSort = nextSortState(this.noteSort, field);
        this.notePage = 1;
      }
      void this.refresh();
    });
    return el(this.doc, 'th', { class: cssClass }, [header]);
  }

  private async refreshNotes(): Promise<void> {
    const store = this.store;
    if (store === null) {
      this.notes = [];
      this.noteInfo = computePageInfo(1, this.notePageSize, 0);
      return;
    }
    const sort = this.noteSort;
    const sortField = sort === null ? null : (NOTE_SORT_FIELDS[sort.field] ?? null);
    let candidatePaths: string[];
    if (sort !== null && sortField !== null) {
      // The notes are sorted globally: the metadata of every note is read with
      // one command, only the notes of the page are read in full afterwards.
      let summaries = await store.listNoteSummaries();
      if (this.query.length > 0) {
        const matches = new Set(await store.searchNotePaths(this.query, this.noteScope));
        summaries = summaries.filter((note) => matches.has(note.path));
      }
      const ordered = sortRows(summaries, sort, sortField.value, sortField.type);
      candidatePaths = ordered.map((note) => note.path);
    } else {
      candidatePaths = [
        ...(this.query.length === 0
          ? await store.listNotePaths()
          : await store.searchNotePaths(this.query, this.noteScope)),
      ];
    }

    const info = computePageInfo(this.notePage, this.notePageSize, candidatePaths.length);
    const start = (info.page - 1) * this.notePageSize;
    const pagePaths = candidatePaths.slice(start, start + this.notePageSize);

    const notes: Note[] = [];
    for (const path of pagePaths) {
      try {
        notes.push(await store.readNote(path));
      } catch (error) {
        // The file disappeared between the listing and the read: skip it.
        if (error instanceof ApiError && error.status === 404) {
          continue;
        }
        throw error;
      }
    }

    this.notes = notes;
    this.noteInfo = info;
    this.notePage = info.page;
  }

  /** Loads one page of the flat list of the tasks. */
  private async refreshList(): Promise<void> {
    const store = this.store;
    if (store === null) {
      this.tasks = [];
      this.info = computePageInfo(1, this.pageSize, 0);
      return;
    }
    const sort = this.taskSort;
    const sortField = sort === null ? null : (TASK_SORT_FIELDS[sort.field] ?? null);
    let candidatePaths: string[] | null;
    let ordered: readonly TaskSummary[] | null = null;
    if (sort !== null && sortField !== null) {
      // The list is sorted globally: the metadata of every task is read with
      // one command, only the tasks of the page are read in full afterwards.
      let summaries = await store.listTasks();
      if (this.query.length > 0) {
        const matching = await store.searchTaskPaths(this.query);
        const matches = new Set(matching);
        summaries = summaries.filter((task) => matches.has(task.path));
      }
      ordered = sortRows(summaries, sort, sortField.value, sortField.type);
      candidatePaths = null;
    } else {
      candidatePaths =
        this.query.length === 0
          ? [...(await store.listTaskPaths())]
          : [...(await store.searchTaskPaths(this.query))];
    }

    const total = ordered === null ? (candidatePaths as string[]).length : ordered.length;
    const info = computePageInfo(this.page, this.pageSize, total);
    const start = (info.page - 1) * this.pageSize;
    const pagePaths =
      ordered === null
        ? (candidatePaths as string[]).slice(start, start + this.pageSize)
        : ordered.slice(start, start + this.pageSize).map((task) => task.path);

    const tasks: Task[] = [];
    for (const path of pagePaths) {
      try {
        tasks.push(await store.readTask(path));
      } catch (error) {
        // The file disappeared between the listing and the read: skip it.
        if (error instanceof ApiError && error.status === 404) {
          continue;
        }
        throw error;
      }
    }

    const childCounts = await store.childCounts().catch(() => new Map<number, number>());
    const commentCounts = await store.commentCounts().catch(() => new Map<number, number>());
    const seededDates = await this.seedTaskDates(
      tasks.map((task) => ({
        id: task.id,
        path: this.pathOfTask(task.id),
        start: task.start,
        end: task.end,
      })),
    );
    this.tasks = tasks.map((task) => {
      const seeded = seededDates.get(task.id);
      return seeded === undefined ? task : { ...task, ...seeded };
    });
    this.info = info;
    this.page = info.page;
    this.childCounts = new Map(childCounts);
    this.commentCounts = new Map(commentCounts);
  }

  /**
   * Reads the structure of the tasks and the tasks that are displayed.
   *
   * The content of the files never reaches the browser here: only the metadata
   * of the tasks is read.
   */
  private async refreshTree(): Promise<void> {
    const store = this.store;
    if (store === null) {
      this.treeHierarchy = null;
      this.treeStructure = null;
      return;
    }
    const summaries = await store.listTasks();
    this.applyHierarchy(summaries);
    await this.seedTaskDates(summaries);
    this.treeMatches = await this.searchTaskIds();
    this.commentCounts = new Map(await store.commentCounts().catch(() => new Map<number, number>()));

    await this.updateTreeRows();
  }

  /**
   * The ids of the tasks that match the term of the search.
   *
   * `null` when the search box is empty: the views then show everything.
   */
  private async searchTaskIds(): Promise<Set<number> | null> {
    if (this.query.length === 0) {
      return null;
    }
    const store = this.store;
    if (store === null) {
      return new Set<number>();
    }
    const paths = await store.searchTaskPaths(this.query);
    const ids = new Set<number>();
    for (const path of paths) {
      const id = parseTaskIdFromFileName(path.slice(path.lastIndexOf('/') + 1));
      if (id !== null) {
        ids.add(id);
      }
    }
    return ids;
  }

  /**
   * Reads the cards of the board.
   *
   * Only the tasks that have **no child** belong to the board.
   */
  private async refreshKanban(): Promise<void> {
    const store = this.store;
    if (store === null) {
      this.kanbanCards = [];
      return;
    }
    const summaries = await store.listTasks();
    await this.seedTaskDates(summaries);
    const parents = new Set<number>();
    for (const task of summaries) {
      if (task.parentId !== null) {
        parents.add(task.parentId);
      }
    }
    const matches = await this.searchTaskIds();
    this.treeMatches = matches;
    this.commentCounts = new Map(await store.commentCounts().catch(() => new Map<number, number>()));
    this.kanbanCards = summaries
      .filter((task) => !parents.has(task.id))
      // The search of the board shows only the leaves that match: the other
      // cards come back when the search box is emptied.
      .filter((task) => matches === null || matches.has(task.id))
      .map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        parentId: task.parentId,
        tags: task.tags,
        path: task.path,
      }));
  }

  /**
   * Reads the metadata of the tasks for the Gantt chart.
   *
   * The chart needs the parent, the status, the title and the dates of every
   * task.
   */
  private async refreshGantt(): Promise<void> {
    const store = this.store;
    if (store === null) {
      this.ganttMetadata = new Map<number, TaskSummary>();
      return;
    }
    const summaries = await store.listTasks();
    const seededDates = await this.seedTaskDates(summaries);
    this.applyHierarchy(summaries);
    this.treeMatches = await this.searchTaskIds();
    this.commentCounts = new Map(await store.commentCounts().catch(() => new Map<number, number>()));
    this.ganttMetadata = new Map<number, TaskSummary>(
      summaries.map((task) => {
        const seeded = seededDates.get(task.id);
        return seeded === undefined ? [task.id, task] : [task.id, { ...task, ...seeded }];
      }),
    );
  }

  /** Builds the hierarchy of the tasks from their metadata. */
  private applyHierarchy(summaries: readonly TaskSummary[]): void {
    const parents = new Map<number, number | null>();
    const paths = new Map<number, string>();
    const expanded = new Set<number>();
    for (const task of summaries) {
      parents.set(task.id, task.parentId);
      paths.set(task.id, task.path);
      // The files carry the expanded state: every refresh re-derives the set
      // from them, so the disk is always the source of truth.
      if (task.expanded) {
        expanded.add(task.id);
      }
    }
    this.treeExpanded = expanded;
    this.treeHierarchy = { parents, paths };
    this.treeStructure = buildTaskTree(parents);
  }

  /** Recomputes the rows of the tree and loads the tasks that are shown. */
  private async updateTreeRows(): Promise<void> {
    const structure = this.treeStructure;
    if (structure === null) {
      this.treeRows = [];
      this.treeTasks = new Map<number, Task>();
      return;
    }
    const rows = flattenTaskTree(structure, {
      focusId: this.treeFocusId,
      expanded: this.treeExpanded,
      matches: this.treeMatches,
    });
    this.treeRows = rows;
    this.treeTasks = await this.loadTreeTasks(rows);
  }

  /**
   * Reads the files of the tasks that are displayed.
   *
   * Only the visible rows are read, and the tasks that are not displayed any
   * more are released: the memory holds the tree that is on the screen.
   */
  private async loadTreeTasks(rows: readonly TreeRow[]): Promise<Map<number, Task>> {
    const hierarchy = this.treeHierarchy;
    const tasks = new Map<number, Task>();
    if (hierarchy === null) {
      return tasks;
    }
    const missing: number[] = [];
    for (const row of rows) {
      const cached = this.treeTasks.get(row.id);
      if (cached !== undefined) {
        tasks.set(row.id, cached);
        continue;
      }
      missing.push(row.id);
    }
    for (const [id, task] of await this.readTasks(hierarchy, missing)) {
      tasks.set(id, task);
    }
    return tasks;
  }

  /** Reads the given task files, a few of them at a time. */
  private async readTasks(
    hierarchy: TaskHierarchy,
    ids: readonly number[],
  ): Promise<Map<number, Task>> {
    const loaded = new Map<number, Task>();
    if (ids.length === 0) {
      return loaded;
    }
    let index = 0;
    const worker = async (): Promise<void> => {
      while (index < ids.length) {
        const position = index;
        index += 1;
        const id = ids[position];
        if (id === undefined) {
          continue;
        }
        const path = hierarchy.paths.get(id);
        if (path === undefined) {
          continue;
        }
        try {
          const task = await this.store?.readTask(path);
          if (task !== undefined) {
            loaded.set(id, task);
          }
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) {
            // The file disappeared between the listing and the read: skip it.
            continue;
          }
          throw error;
        }
      }
    };
    const workers: Promise<void>[] = [];
    const amount = Math.min(TREE_READ_CONCURRENCY, ids.length);
    for (let workerIndex = 0; workerIndex < amount; workerIndex += 1) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return loaded;
  }

  private handleError(error: unknown): void {
    if (error instanceof ApiUnavailableError) {
      this.setServiceState('offline');
      return;
    }
    if (error instanceof ApiError && error.status === 401) {
      void this.handleUnauthorized();
      return;
    }
    showToast({
      doc: this.doc,
      message: error instanceof Error ? error.message : String(error),
      kind: 'error',
    });
  }

  /**
   * Reacts to a `401` answer of the service.
   *
   * The service may have been restarted with a token (or without one), so the
   * authentication policy is read again before the token dialog is shown: the
   * user is only asked for a token when the service really needs one.
   */
  private async handleUnauthorized(): Promise<void> {
    const status = await this.api.fetchServiceStatus();
    if (!status.available) {
      this.setServiceState('offline');
      return;
    }
    this.authRequired = status.authRequired;
    this.updateAuthUi();
    if (this.authRequired === false) {
      this.setServiceState('online');
      showToast({
        doc: this.doc,
        message:
          'The Gnumarus OS Bridge service refused the request (401) even though it does not require a token.',
        kind: 'error',
      });
      return;
    }
    this.setServiceState('unauthorized');
    this.openTokenDialog();
  }

  /** Draws the view mode that is in use. */
  private renderCurrentView(): void {
    const mode = this.viewMode;
    this.tableWrapElement.toggleAttribute('hidden', mode !== 'list');
    this.notesWrapElement.toggleAttribute('hidden', mode !== 'notes');
    this.treeWrapElement.toggleAttribute('hidden', mode !== 'tree');
    this.kanbanElement.toggleAttribute('hidden', mode !== 'kanban');
    this.ganttElement.toggleAttribute('hidden', mode !== 'gantt');
    this.paginationElement.toggleAttribute('hidden', mode !== 'list' && mode !== 'notes');
    if (mode === 'tree') {
      this.renderTree();
    } else if (mode === 'kanban') {
      this.renderKanban();
    } else if (mode === 'gantt') {
      this.renderGantt();
    } else if (mode === 'notes') {
      this.renderNotes();
    } else {
      this.renderList();
    }
  }

  /** Draws the list of the notes. */
  private renderNotes(): void {
    this.renderNoteTableHead();
    clear(this.noteRowsElement);
    for (const row of renderNoteRows(this.doc, this.notes, {
      onView: (note) => {
        this.openNoteViewDialog(note);
      },
      onEdit: (note) => {
        this.openNoteEditDialog(note);
      },
      onDelete: (note) => {
        this.openNoteDeleteDialog(note);
      },
    })) {
      this.noteRowsElement.append(row);
    }

    const isEmpty = this.notes.length === 0;
    this.noteRowsElement.parentElement?.classList.toggle('table-empty', isEmpty);
    this.updateEmptyState(isEmpty);

    clear(this.paginationElement);
    this.paginationElement.append(
      renderPaginationBar(this.doc, this.noteInfo, {
        itemLabel: 'notes',
        showPageJump: true,
        showPageSize: true,
        onPage: (page) => {
          void this.goToNotePage(page);
        },
        onPageSize: (pageSize) => {
          void this.setNotePageSize(pageSize);
        },
      }),
    );

    this.resultCountElement.textContent = this.buildResultCount();
    this.updateToolbarState();
  }

  /** Draws the flat list of the tasks. */
  private renderList(): void {
    this.renderTaskTableHead();

    clear(this.rowsElement);
    for (const row of renderTaskRows(this.doc, this.tasks, {
      onView: (task) => {
        void this.openViewDialog(task);
      },
      onEdit: (task) => {
        this.openEditDialog(task);
      },
      onAddChild: (task) => {
        this.openCreateDialog(task);
      },
      onDelete: (task) => {
        this.openDeleteDialog(task);
      },
      onOpenParent: (parentId) => {
        void this.openTaskById(parentId);
      },
    }, this.childCounts, this.commentCounts)) {
      this.rowsElement.append(row);
    }

    const isEmpty = this.tasks.length === 0;
    this.rowsElement.parentElement?.classList.toggle('table-empty', isEmpty);
    this.updateEmptyState(isEmpty);

    clear(this.paginationElement);
    this.paginationElement.append(
      renderPaginationBar(this.doc, this.info, {
        onPage: (page) => {
          void this.goToPage(page);
        },
      }),
    );

    this.resultCountElement.textContent = this.buildResultCount();
    this.updateToolbarState();
  }

  /** Draws the tree of the tasks. */
  private renderTree(): void {
    this.renderTreeHeader();

    clear(this.treeRowsElement);
    for (const row of renderTreeRows(this.doc, this.treeRows, this.treeTasks, {
      onToggle: (id, recursive) => {
        void this.toggleTreeNode(id, recursive);
      },
      onFocus: (id) => {
        void this.focusTree(id);
      },
      onView: (task) => {
        void this.openViewDialog(task);
      },
      onEdit: (task) => {
        this.openEditDialog(task);
      },
      onAddChild: (task) => {
        this.openCreateDialog(task);
      },
    }, this.commentCounts)) {
      this.treeRowsElement.append(row);
    }

    this.updateEmptyState(this.treeRows.length === 0);
    this.resultCountElement.textContent = this.buildResultCount();
    this.updateToolbarState();
  }

    /** Draws the board of the tasks: one column per status. */
  private renderKanban(): void {
    clear(this.kanbanElement);
    this.kanbanElement.append(
      renderKanbanBoard(this.doc, this.kanbanCards, {
        onDrop: (taskId, status) => {
          void this.changeTaskStatus(taskId, status);
        },
        onOpen: (taskId) => {
          void this.openTaskById(taskId);
        },
        onEdit: (taskId) => {
          void this.openEditTaskById(taskId);
        },
      }, this.commentCounts),
    );

    this.updateEmptyState(this.kanbanCards.length === 0);
    this.resultCountElement.textContent = this.buildResultCount();
    this.updateToolbarState();
  }

  /** Draws the Gantt chart of the tasks. */
  private renderGantt(): void {
    clear(this.ganttElement);
    this.ganttScheduleState = null;
    this.ganttLayoutState = null;
    this.ganttChartOriginElement = null;

    const header = el(this.doc, 'div', { class: 'gantt-focus-header' });
    this.renderFocusHeader(
      header,
      'gantt-focus',
      this.treeFocusId === null ? undefined : this.ganttMetadata.get(this.treeFocusId)?.title,
      false,
    );

    const rows = this.ganttRows();
    const schedule = this.ganttSchedule(rows);
    if (schedule === null) {
      this.ganttElement.append(
        el(this.doc, 'div', { class: 'gantt-view' }, [
          header,
          el(this.doc, 'div', { class: 'gantt-empty', text: 'No task has a start or an end date yet.' }),
        ]),
      );
      this.updateEmptyState(false);
      this.resultCountElement.textContent = this.buildResultCount();
      this.updateToolbarState();
      return;
    }

    const layout = buildLayout(schedule, this.ganttCollapsed);
    const tasks = this.ganttTasks(rows, layout, schedule);

    this.ganttElement.append(
      el(this.doc, 'div', { class: 'gantt-view' }, [
        header,
        renderGanttView(
          {
            doc: this.doc,
            rows,
            tasks,
            schedule,
            layout,
            commentCounts: this.commentCounts,
          },
          {
            onToggle: (id, recursive) => {
              void this.toggleTreeNode(id, recursive);
            },
            onFocus: (id) => {
              void this.focusTree(id);
            },
            onOpen: (id) => {
              void this.openTaskById(id);
            },
            onEdit: (id) => {
              void this.openEditTaskById(id);
            },
            onAddChild: (id) => {
              void this.openAddChildTaskById(id);
            },
            onToggleWeek: (key) => {
              this.toggleGanttPeriod(key);
            },
            onToggleMonth: (key) => {
              this.toggleGanttMonth(key);
            },
          },
        ),
      ]),
    );

    // The drag of the bars needs the chart that is on the screen. The headers
    // share the left edge of the columns of the chart.
    this.ganttScheduleState = schedule;
    this.ganttLayoutState = layout;
    this.ganttChartOriginElement =
      this.ganttElement.querySelector<HTMLElement>('.gantt-heads') ?? this.ganttElement;

    this.updateEmptyState(rows.length === 0);
    this.resultCountElement.textContent = this.buildResultCount();
    this.updateToolbarState();
  }

  /** The chart currently drawn, `null` when there is none. */
  private ganttDragContext(): GanttDragContext | null {
    const schedule = this.ganttScheduleState;
    const layout = this.ganttLayoutState;
    if (schedule === null || layout === null || this.ganttChartOriginElement === null) {
      return null;
    }
    return {
      columns: layout.columns,
      schedule,
      chart: this.ganttChartOriginElement,
    };
  }

  /**
   * Changes the start and the end date of a task.
   *
   * The dates are dragged on the chart of the Gantt view.
   */
  private async changeTaskDates(taskId: number, start: string, end: string): Promise<void> {
    await this.updateTaskFields(taskId, (task) => withDates(task, start, end, new Date()));
  }

  /** The path of the file of a task, relative to the project folder. */
  private pathOfTask(taskId: number): string {
    return (
      this.treeHierarchy?.paths.get(taskId) ?? this.store?.taskPath(taskId) ?? `task_${taskId}.txt`
    );
  }

  /**
   * Reads a task, applies a change to it and writes it back.
   *
   * The file of the task is the only thing that is touched: the change is the
   * same in the service mode and in the embedded mode.
   */
  private async updateTaskFields(
    taskId: number,
    change: (task: Task) => Task,
  ): Promise<void> {
    const store = this.store;
    if (store === null) {
      return;
    }
    const path = this.pathOfTask(taskId);
    this.setBusy(true);
    try {
      const task = await store.readTask(path);
      await store.writeTask(path, change(task));
      await this.refresh();
    } catch (error) {
      this.handleError(error);
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * Assigns the dates the loaded tasks do not have.
   *
   * A task is loaded without a start date: **today** is assigned to it; without
   * an end date: **tomorrow**. The change is written into the file of the task
   * (only the ones that miss a date, so it happens once), and the dates that
   * were assigned are given back, so the current view can show them without
   * another refresh.
   */
  private async seedTaskDates(
    tasks: readonly {
      readonly id: number;
      readonly path: string;
      readonly start: string;
      readonly end: string;
    }[],
  ): Promise<ReadonlyMap<number, { readonly start: string; readonly end: string }>> {
    const store = this.store;
    const assigned = new Map<number, { readonly start: string; readonly end: string }>();
    if (store === null) {
      return assigned;
    }
    const today = new Date();
    for (const entry of tasks) {
      if (entry.start.length > 0 && entry.end.length > 0) {
        continue;
      }
      try {
        const task = await store.readTask(entry.path);
        const seeded = withDefaultDates(task, today);
        if (seeded.start !== task.start || seeded.end !== task.end) {
          await store.writeTask(entry.path, seeded);
        }
        assigned.set(entry.id, { start: seeded.start, end: seeded.end });
      } catch {
        // The file cannot be read (it disappeared, it is not a task any more):
        // it is skipped.
      }
    }
    return assigned;
  }

  /** The rows of the Gantt chart: the visible rows of the tree. */
  private ganttRows(): TreeRow[] {
    const structure = this.treeStructure;
    if (structure === null) {
      return [];
    }
    return flattenTaskTree(structure, {
      focusId: this.treeFocusId,
      expanded: this.treeExpanded,
      // The search works like the one of the tree: the matches are shown,
      // together with their whole chain of ancestors.
      matches: this.treeMatches,
    });
  }

  /**
   * The days of the schedule, from the dates of the displayed tasks.
   *
   * Only the rows on the screen count, so focusing or searching changes the
   * visible weeks. One margin week is kept before the smallest start and one
   * after the largest end, so the bars never touch the edges of the chart.
   */
  private ganttSchedule(rows: readonly TreeRow[]): GanttSchedule | null {
    let from: Date | null = null;
    let to: Date | null = null;

    for (const row of rows) {
      const task = this.ganttMetadata.get(row.id);
      if (task === undefined) {
        continue;
      }
      const start = dayOfTimestamp(task.start);
      const end = dayOfTimestamp(task.end);
      for (const date of [start, end]) {
        if (date === null) {
          continue;
        }
        if (from === null || date.getTime() < from.getTime()) {
          from = date;
        }
        if (to === null || date.getTime() > to.getTime()) {
          to = date;
        }
      }
    }

    if (from === null || to === null) {
      return null;
    }
    return buildPaddedSchedule(from, to);
  }

  /** The tasks of the chart, with their bar. */
  private ganttTasks(
    rows: readonly TreeRow[],
    layout: GanttLayout,
    schedule: GanttSchedule,
  ): Map<number, GanttTask> {
    const tasks = new Map<number, GanttTask>();
    const structure = buildTaskTree(
      new Map([...this.ganttMetadata].map(([id, task]) => [id, task.parentId] as const)),
    );

    for (const row of rows) {
      const metadata = this.ganttMetadata.get(row.id);
      if (metadata === undefined) {
        continue;
      }
      const start = dayOfTimestamp(metadata.start);
      const end = dayOfTimestamp(metadata.end);
      const startDay = start === null ? null : daysBetween(schedule.start, start);
      const endDay = end === null ? null : daysBetween(schedule.start, end);
      const bar =
        startDay === null && endDay === null
          ? null
          : barOf(layout.columns, startDay, endDay);
      tasks.set(row.id, {
        id: metadata.id,
        title: metadata.title,
        status: metadata.status,
        bar,
        startDay,
        endDay,
        hasChildren: (structure.children.get(metadata.id) ?? []).length > 0,
      });
    }
    return tasks;
  }

  /** Collapses or expands a week (or a month) of the chart. */
  private toggleGanttPeriod(key: string): void {
    if (this.ganttCollapsed.has(key)) {
      this.ganttCollapsed.delete(key);
    } else {
      this.ganttCollapsed.add(key);
    }
    this.renderGantt();
  }

  /**
   * Collapses or expands every week of a month.
   *
   * The months are not collapsed themselves: they follow the days, so they
   * cannot be drawn as a single column. Clicking a month is a shortcut for
   * every week holding at least one day of that month, even when the week
   * starts in another month.
   */
  private toggleGanttMonth(monthKey: string): void {
    const schedule = this.ganttScheduleState;
    if (schedule === null) {
      return;
    }
    const weeks = schedule.weeks.filter((week) => {
      for (let offset = 0; offset < week.days; offset += 1) {
        const date = dayOfIndex(schedule, week.firstDayIndex + offset);
        if (isoDate(startOfMonth(date)) === monthKey) {
          return true;
        }
      }
      return false;
    });
    if (weeks.length === 0) {
      return;
    }
    const expand = weeks.some((week) => this.ganttCollapsed.has(week.key));
    for (const week of weeks) {
      if (expand) {
        this.ganttCollapsed.delete(week.key);
      } else {
        this.ganttCollapsed.add(week.key);
      }
    }
    this.renderGantt();
  }

  /**
   * Draws the header of the tree: the chain of the tasks the tree is focused
   * on, from the general root down to the focused task.
   */
  private renderTreeHeader(): void {
    this.renderFocusHeader(
      this.treeHeaderElement,
      'tree',
      this.treeFocusId === null ? undefined : this.treeTasks.get(this.treeFocusId)?.title,
      true,
    );
  }

  /**
   * Draws the focus breadcrumb of a view.
   *
   * The first crumb ("General root") resets the focus. The tree uses the same
   * header as the Gantt chart, so both views can be focused and reset in the
   * same way; only the tree is a drop target of the drag of the tasks.
   */
  private renderFocusHeader(
    container: HTMLElement,
    prefix: 'tree' | 'gantt-focus',
    focusedTitle: string | undefined,
    rootTarget: boolean,
  ): void {
    clear(container);

    const generalRoot = el(this.doc, 'button', {
      class: `${prefix}-crumb${rootTarget ? ` ${ROOT_TARGET_CLASS}` : ''}`,
      text: 'General root',
      title: rootTarget
        ? 'Show every task that has no parent (drop a task here to make it a root task)'
        : 'Show every task that has no parent (reset the focus)',
    });
    generalRoot.type = 'button';
    if (this.treeFocusId === null) {
      generalRoot.classList.add('is-active');
    }
    generalRoot.addEventListener('click', () => {
      void this.focusTree(null);
    });

    const crumbs: Child[] = [generalRoot];
    const structure = this.treeStructure;
    if (this.treeFocusId !== null && structure !== null) {
      for (const ancestorId of ancestorsOf(structure, this.treeFocusId)) {
        crumbs.push(el(this.doc, 'span', { class: `${prefix}-crumb-sep`, text: '›' }));
        const crumb = el(this.doc, 'button', {
          class: `${prefix}-crumb`,
          text: `#${ancestorId}`,
          title: `Focus on the task #${ancestorId}`,
        });
        crumb.type = 'button';
        crumb.addEventListener('click', () => {
          void this.focusTree(ancestorId);
        });
        crumbs.push(crumb);
      }
      crumbs.push(el(this.doc, 'span', { class: `${prefix}-crumb-sep`, text: '›' }));
      crumbs.push(
        el(this.doc, 'span', {
          class: `${prefix}-crumb is-active`,
          text: focusedTitle === undefined ? `#${this.treeFocusId}` : focusedTitle,
        }),
      );
    }

    container.append(
      el(this.doc, 'span', { class: `${prefix}-header-label`, text: 'Focus' }),
      el(this.doc, 'nav', { class: `${prefix}-breadcrumb` }, crumbs),
    );
  }

  /** Shows the message of the empty state, when there is nothing to show. */
  private updateEmptyState(isEmpty: boolean): void {
    const notes = this.viewMode === 'notes';
    if (this.config.mode === 'filesystem' && this.store === null) {
      if (this.fileSystemHandle === null) {
        this.showEmptyState(
          'Choose the folder of your project',
          'The File System Access API gives the application the access to a folder of your disk, chosen by you. The application then works without the low level service.',
          'Choose folder…',
          () => {
            void this.openFolderPicker();
          },
        );
      } else {
        this.showEmptyState(
          `Give the access to the folder "${this.fileSystemDirectoryName ?? ''}"`,
          'The browser asks for the access to the folder every time the page is opened.',
          'Grant the access',
          () => {
            void this.grantFileSystemAccess();
          },
        );
      }
      return;
    }
    if (!this.hasProject()) {
      if (this.config.mode === 'embedded') {
        // The files of the embedded project live in the browser: there is no
        // folder to choose, the storage itself refused to open.
        this.showEmptyState(
          'The storage of the browser is not available',
          'The files of the project live at the root of the storage of the browser. It refused to open, so the project cannot be used for now.',
          'Try again',
          () => {
            void this.reloadProject();
          },
        );
        return;
      }
      this.showEmptyState(
        notes
          ? 'Choose the folder that will hold your notes'
          : 'Choose the folder that will hold your tasks',
        notes
          ? 'Every note is a text file named note_<id>.txt inside that folder.'
          : 'Every task is a text file named task_<id>.txt inside that folder.',
        'Choose folder…',
        () => {
          void this.openFolderPicker();
        },
      );
      return;
    }
    if (isEmpty && this.query.length > 0) {
      this.showEmptyState(
        notes ? `No note matches "${this.query}"` : `No task matches "${this.query}"`,
        notes
          ? 'Try another search term or clear the search to see every note.'
          : 'Try another search term or clear the search to see every task.',
        'Clear search',
        () => {
          this.applySearch('');
        },
      );
      return;
    }
    if (isEmpty) {
      // The embedded project has no folder: its files live at the root of the
      // storage of the browser.
      const place = this.config.mode === 'embedded' ? 'The project' : 'This folder';
      this.showEmptyState(
        notes ? `${place} does not contain any note yet` : `${place} does not contain any task yet`,
        notes ? 'Create the first note to get started.' : 'Create the first task to get started.',
        notes ? 'New note' : 'New task',
        () => {
          if (notes) {
            this.openNoteCreateDialog();
          } else {
            this.openCreateDialog();
          }
        },
      );
      return;
    }
    this.hideEmptyState();
  }

  /**
   * True when the project is ready to be used.
   *
   * The **store** is the only thing that matters: the service mode needs a
   * folder, the File System Access mode needs the handle of a folder and the
   * embedded mode needs the storage of the browser.
   *
   * The embedded project has **no folder at all**: its files live at the root
   * of the storage of the browser (the OPFS when the browser offers it), so
   * the user is never asked for a folder in that mode.
   */
  private hasProject(): boolean {
    return this.store !== null;
  }

  /**
   * Tells the user why the project cannot be used yet.
   *
   * The message depends on the kind of storage: only the service mode asks
   * for a folder.
   */
  private reportMissingProject(): void {
    let message: string;
    if (this.config.mode === 'filesystem') {
      message = 'Choose the folder of the project first.';
    } else if (this.config.mode === 'embedded') {
      message = 'The storage of the browser is not available.';
    } else {
      message = 'Choose a project folder first.';
    }
    showToast({ doc: this.doc, message, kind: 'error' });
  }

  /** Opens the storage of the project again, after a failure. */
  private async reloadProject(): Promise<void> {
    await this.openStore();
    this.updateProjectPath();
    await this.refresh();
  }

  /** Keeps the state of the toolbar in sync with the current view. */
  private updateToolbarState(): void {
    const hasProject = this.hasProject();
    this.clearSearchButton.toggleAttribute('hidden', this.query.length === 0);
    this.newTaskButton.toggleAttribute('disabled', !hasProject);
  }

  private buildResultCount(): string {
    if (!this.hasProject()) {
      return '';
    }
    if (this.viewMode === 'notes') {
      const total = this.noteInfo.totalItems;
      if (this.query.length > 0) {
        return `${total} result${total === 1 ? '' : 's'} for "${this.query}"`;
      }
      return `${total} note${total === 1 ? '' : 's'}`;
    }
    if (this.viewMode === 'kanban') {
      const count = this.kanbanCards.length;
      return `${count} card${count === 1 ? '' : 's'}`;
    }
    if (this.viewMode === 'gantt') {
      const count = this.ganttMetadata.size;
      return `${count} task${count === 1 ? '' : 's'}`;
    }
    if (this.viewMode === 'tree') {
      const total = this.treeHierarchy?.parents.size ?? 0;
      const shown = this.treeRows.length;
      if (this.query.length > 0) {
        return `${shown} result${shown === 1 ? '' : 's'} for "${this.query}"`;
      }
      if (shown === total) {
        return `${total} task${total === 1 ? '' : 's'}`;
      }
      return `${shown} of ${total} tasks`;
    }
    if (this.query.length > 0) {
      return `${this.info.totalItems} result${this.info.totalItems === 1 ? '' : 's'} for "${this.query}"`;
    }
    return `${this.info.totalItems} task${this.info.totalItems === 1 ? '' : 's'}`;
  }

  private showEmptyState(
    title: string,
    message: string,
    actionLabel: string,
    onAction: () => void,
  ): void {
    clear(this.emptyStateElement);
    this.emptyStateElement.removeAttribute('hidden');
    this.emptyStateElement.append(
      el(this.doc, 'h2', { class: 'empty-title', text: title }),
      el(this.doc, 'p', { class: 'empty-message', text: message }),
      button(this.doc, actionLabel, {
        class: 'primary',
        onClick: onAction,
      }),
    );
  }

  private hideEmptyState(): void {
    this.emptyStateElement.setAttribute('hidden', 'hidden');
    clear(this.emptyStateElement);
  }

  private setBusy(busy: boolean): void {
    this.root.classList.toggle('busy', busy);
  }

  // -------------------------------------------------------------- actions --

  /** Switches between the flat list and the tree of the tasks. */
  private async setViewMode(mode: ViewMode): Promise<void> {
    if (this.viewMode === mode) {
      return;
    }
    this.viewMode = mode;
    this.updateViewToggle();
    this.updateToolbarForMode();
    await this.refresh();
  }

  private updateViewToggle(): void {
    this.listViewButton.classList.toggle('is-active', this.viewMode === 'list');
    this.treeViewButton.classList.toggle('is-active', this.viewMode === 'tree');
    this.kanbanViewButton.classList.toggle('is-active', this.viewMode === 'kanban');
    this.ganttViewButton.classList.toggle('is-active', this.viewMode === 'gantt');
    this.notesViewButton.classList.toggle('is-active', this.viewMode === 'notes');
    this.listViewButton.setAttribute('aria-pressed', this.viewMode === 'list' ? 'true' : 'false');
    this.treeViewButton.setAttribute('aria-pressed', this.viewMode === 'tree' ? 'true' : 'false');
    this.kanbanViewButton.setAttribute('aria-pressed', this.viewMode === 'kanban' ? 'true' : 'false');
    this.ganttViewButton.setAttribute('aria-pressed', this.viewMode === 'gantt' ? 'true' : 'false');
    this.notesViewButton.setAttribute('aria-pressed', this.viewMode === 'notes' ? 'true' : 'false');
  }

  /**
   * Adapts the toolbar to the display mode.
   *
   * The notes have their own search (with its scope) and their own button to
   * create them: the toolbar of the tasks is left untouched.
   */
  private updateToolbarForMode(): void {
    const notes = this.viewMode === 'notes';
    this.noteScopeSelect.toggleAttribute('hidden', !notes);
    this.searchInput.placeholder = notes
      ? 'Search notes by title or content…'
      : 'Search tasks by title, tag or description…';
    const label = notes ? 'New note' : 'New task';
    this.newTaskButton.replaceChildren(
      this.doc.createTextNode(label),
      createIcon(this.doc, notes ? 'file' : 'plus'),
    );
  }

  /**
   * Makes a task the root of the displayed tree.
   *
   * `null` focuses the general root: every task that has no parent is shown.
   */
  private async focusTree(id: number | null): Promise<void> {
    if (this.treeFocusId === id) {
      return;
    }
    this.treeFocusId = id;
    if (id !== null) {
      // The focused task shows its children right away, and it stays expanded
      // the next time the app is opened.
      this.treeExpanded.add(id);
      await this.persistExpandedState(id, true);
    }
    await this.updateTree();
  }

  /**
   * Collapses or expands the children of a task of the tree.
   *
   * A simple click only changes the task itself: the state of its children is
   * kept. With the control key the whole branch is collapsed or expanded, the
   * task and every one of its descendants.
   *
   * Every change is written into the `expanded=` key of the files, so the state
   * is restored when the app is opened again.
   */
  private async toggleTreeNode(id: number, recursive: boolean): Promise<void> {
    const expanded = !this.treeExpanded.has(id);
    let changed: readonly number[] = [id];
    if (recursive) {
      changed = this.setSubtreeExpanded(id, expanded);
    } else if (expanded) {
      this.treeExpanded.add(id);
    } else {
      this.treeExpanded.delete(id);
    }
    await this.updateTree();
    for (const changedId of changed) {
      void this.persistExpandedState(changedId, expanded);
    }
  }

  /** Collapses or expands a task and all its descendants. */
  private setSubtreeExpanded(id: number, expanded: boolean): readonly number[] {
    const structure = this.treeStructure;
    if (structure === null) {
      return [];
    }
    const changed: number[] = [];
    for (const descendant of subtreeOf(structure, id)) {
      const isChanged = expanded ? !this.treeExpanded.has(descendant) : this.treeExpanded.has(descendant);
      if (isChanged) {
        changed.push(descendant);
      }
      if (expanded) {
        this.treeExpanded.add(descendant);
      } else {
        this.treeExpanded.delete(descendant);
      }
    }
    return changed;
  }

  /**
   * Writes the `expanded=` key of the file of a task.
   *
   * It is a view preference, not a change of the content: the write is silent
   * (a failure must not disturb the user) and **follows** the change of the
   * screen (the state of the interface is not held back by the disk).
   */
  private async persistExpandedState(taskId: number, expanded: boolean): Promise<void> {
    const store = this.store;
    if (store === null) {
      return;
    }
    try {
      const path = this.pathOfTask(taskId);
      const task = await store.readTask(path);
      await store.writeTask(path, withExpandedState(task, expanded));
    } catch {
      // The tree has already been drawn: an unreachable file cannot break it.
    }
  }

  /** Recomputes the tree and draws it again. */
  private async updateTree(): Promise<void> {
    this.setBusy(true);
    try {
      if (this.viewMode !== 'gantt') {
        // The Gantt chart reads the titles of the tasks with the metadata, it
        // does not need the files of the visible rows.
        await this.updateTreeRows();
      }
      this.renderCurrentView();
    } catch (error) {
      this.handleError(error);
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * Moves a task under another one.
   *
   * The task is dropped on the target task: it becomes its child and leaves
   * its previous parent. A task can never become a child of one of its own
   * descendants, that would build a cycle.
   */
  private async reparentTask(taskId: number, targetId: number | null): Promise<void> {
    const structure = this.treeStructure;
    if (structure !== null) {
      if (targetId !== null && subtreeOf(structure, taskId).includes(targetId)) {
        showToast({
          doc: this.doc,
          message: `The task #${taskId} cannot become a child of the task #${targetId}: it is one of its own descendants.`,
          kind: 'error',
        });
        return;
      }
      if (parentOf(structure, taskId) === targetId) {
        // The task is already the child of the target: nothing to do.
        return;
      }
    }

    showToast({
      doc: this.doc,
      message:
        targetId === null
          ? `The task #${taskId} is now a root task.`
          : `The task #${taskId} is now a child of the task #${targetId}.`,
      kind: 'success',
    });
    if (targetId !== null) {
      // The child that lands on the task has to be visible: the branch of the
      // target is opened, even when its row was collapsed. It is persisted
      // before the move, because the refresh of the move re-derives the set
      // from the files.
      this.treeExpanded.add(targetId);
      await this.persistExpandedState(targetId, true);
    }
    // The moved task becomes expanded as well: its children are shown when the
    // user opens the branch of its new parent.
    await this.updateTaskFields(taskId, (task) => withExpandedState(withParent(task, targetId, new Date()), true));
  }

  /**
   * Changes the status of a task.
   *
   * The card is dropped on the column of another status: the `status=` key of
   * its file is rewritten.
   */
  private async changeTaskStatus(taskId: number, status: TaskStatus): Promise<void> {
    const card = this.kanbanCards.find((candidate) => candidate.id === taskId);
    if (card === undefined || card.status === status) {
      // The task is not on the board any more, or it is already there.
      return;
    }
    showToast({
      doc: this.doc,
      message: `The task #${taskId} is now ${STATUS_LABELS[status]}.`,
      kind: 'success',
    });
    await this.updateTaskFields(taskId, (task) => withStatus(task, status, new Date()));
  }

  /** Opens the editor of a task that is only known by its id. */
  private async openEditTaskById(id: number): Promise<void> {
    const task = await this.loadTaskById(id);
    if (task === null) {
      return;
    }
    this.openEditDialog(task);
  }

  /** Opens the creation dialog of a child of a task that is known by its id. */
  private async openAddChildTaskById(id: number): Promise<void> {
    const task = await this.loadTaskById(id);
    if (task === null) {
      return;
    }
    this.openCreateDialog(task);
  }

  /** The comments of a task, the most recent first. */
  private async loadTaskComments(taskId: number): Promise<readonly TaskComment[]> {
    return this.store?.listComments(taskId) ?? [];
  }

  /** Adds a comment to a task. */
  private async addTaskComment(taskId: number, text: string): Promise<void> {
    await this.store?.createComment(taskId, text);
  }

  /** Changes the text of a comment. */
  private async updateTaskComment(
    _taskId: number,
    commentId: number,
    text: string,
  ): Promise<void> {
    const store = this.store;
    if (store === null) {
      return;
    }
    const comment = await store
      .listComments(_taskId)
      .then((comments) => comments.find((entry) => entry.id === commentId));
    if (comment === undefined) {
      return;
    }
    await store.writeComment({ ...comment, text, updated: formatTaskTimestamp(new Date()) });
  }

  /** Deletes a comment of a task. */
  private async deleteTaskComment(_taskId: number, commentId: number): Promise<void> {
    await this.store?.deleteComment(this.commentPath(commentId));
  }

  /** The path of the file of a comment, relative to the project folder. */
  private commentPath(commentId: number): string {
    return this.store?.commentPath(commentId) ?? commentFileName(commentId);
  }

  /** Reads a task from the project, `null` when it cannot be read. */
  private async loadTaskById(id: number): Promise<Task | null> {
    const store = this.store;
    if (store === null) {
      return null;
    }
    const card = this.kanbanCards.find((candidate) => candidate.id === id);
    const path = card?.path ?? this.pathOfTask(id);
    try {
      return await store.readTask(path);
    } catch (error) {
      this.handleError(error);
      return null;
    }
  }

  private applySearch(value: string): void {
    this.query = value.trim();
    this.searchInput.value = value;
    this.page = 1;
    this.notePage = 1;
    void this.refresh();
  }

  /** Chooses what the search of the notes looks at. */
  private setNoteScope(value: string): void {
    const scope = NOTE_SEARCH_SCOPES.find((candidate) => candidate === value);
    if (scope === undefined) {
      return;
    }
    this.noteScope = scope;
    this.notePage = 1;
    void this.refresh();
  }

  /** Goes to the given page of the notes. */
  private async goToNotePage(page: number): Promise<void> {
    if (page === this.notePage) {
      return;
    }
    this.notePage = page;
    await this.refresh();
  }

  /** Changes the amount of notes per page. */
  private async setNotePageSize(pageSize: number): Promise<void> {
    const size = clampNotePageSize(pageSize);
    this.notePageSize = size;
    this.notePage = 1;
    this.config = { ...this.config, notePageSize: size };
    await this.persistConfig();
    await this.refresh();
  }

  private async goToPage(page: number): Promise<void> {
    if (page === this.page) {
      return;
    }
    this.page = page;
    await this.refresh();
  }

  private async openFolderPicker(): Promise<void> {
    if (this.config.mode === 'filesystem') {
      // The picker of the browser: the user chooses the folder of the project.
      const picked = await this.pickFileSystemDirectory();
      if (!picked) {
        return;
      }
      await this.openStore();
      this.updateProjectPath();
      await this.refresh();
      return;
    }
    if (this.token === null && this.authRequired !== false) {
      this.openTokenDialog();
      return;
    }
    const dialog = new FileDialog({
      doc: this.doc,
      api: this.api,
      mode: 'directory',
      onSelect: (path) => {
        void this.selectFolder(path);
      },
    });
    await dialog.open(this.config.projectDir ?? undefined);
  }

  private async selectFolder(path: string): Promise<void> {
    this.config = { ...this.config, projectDir: path };
    this.page = 1;
    this.query = '';
    this.searchInput.value = '';
    this.updateProjectPath();
    await this.persistConfig();
    // The store follows the folder of the project.
    await this.openStore();
    await this.refresh();
    showToast({ doc: this.doc, message: `Tasks folder set to ${path}`, kind: 'success' });
  }

  private openCreateDialog(parent?: Task): void {
    if (!this.hasProject()) {
      this.reportMissingProject();
      return;
    }
    const dialog = new TaskDialog({
      doc: this.doc,
      mode: 'create',
      parent,
      onSave: async (taskInput: TaskInput) => {
        await this.createTask(taskInput, parent?.id ?? null);
      },
    });
    dialog.open();
  }

  private async openViewDialog(task: Task): Promise<void> {
    const children = await this.loadChildren(task.id);
    const dialog = new TaskDialog({
      doc: this.doc,
      mode: 'view',
      task,
      children,
      onSave: async () => {
        // The read only view never saves.
      },
      onDelete: async () => {
        await this.deleteTask(task);
      },
      onEdit: () => {
        this.openEditDialog(task);
      },
      onAddChild: () => {
        this.openCreateDialog(task);
      },
      onOpenChild: (child) => {
        void this.openViewDialog(child);
      },
    });
    dialog.open();
  }

  private openEditDialog(task: Task): void {
    const dialog = new TaskDialog({
      doc: this.doc,
      mode: 'edit',
      task,
      onSave: async (taskInput: TaskInput) => {
        await this.updateTask(task, taskInput);
      },
      onDelete: async () => {
        await this.deleteTask(task);
      },
      onLoadComments: async (taskId) => {
        return this.loadTaskComments(taskId);
      },
      onAddComment: async (taskId, text) => {
        await this.addTaskComment(taskId, text);
      },
      onUpdateComment: async (taskId, commentId, text) => {
        await this.updateTaskComment(taskId, commentId, text);
      },
      onDeleteComment: async (taskId, commentId) => {
        await this.deleteTaskComment(taskId, commentId);
      },
    });
    dialog.open();
  }

  private openDeleteDialog(task: Task): void {
    const dialog = new TaskDialog({
      doc: this.doc,
      mode: 'view',
      task,
      onSave: async () => {
        // The read only view never saves.
      },
      onDelete: async () => {
        await this.deleteTask(task);
      },
    });
    dialog.open();
  }

  /** Opens the task with the given id, even when it is not on the current page. */
  private async openTaskById(id: number): Promise<void> {
    const task = await this.loadTaskById(id);
    if (task === null) {
      return;
    }
    await this.openViewDialog(task);
  }

  /** The children of a task, loaded from the project. */
  private async loadChildren(parentId: number): Promise<Task[]> {
    const store = this.store;
    if (store === null) {
      return [];
    }
    try {
      const summaries = await store.listTasks();
      const children: Task[] = [];
      for (const summary of summaries) {
        if (summary.parentId !== parentId) {
          continue;
        }
        try {
          children.push(await store.readTask(summary.path));
        } catch {
          // The file disappeared: skip it.
        }
      }
      return children;
    } catch {
      return [];
    }
  }

  private async createTask(taskInput: TaskInput, parentId: number | null): Promise<void> {
    const store = this.store;
    if (store === null) {
      throw new Error('No project selected');
    }
    const id = await store.nextTaskId();
    const task = buildTask(taskInput, id, new Date(), parentId);
    await store.createTaskFile(store.taskPath(id), task);
    if (parentId !== null) {
      // The new child has to be visible: the branch of the parent is opened,
      // whether the parent was collapsed or had no child until now. The state
      // is persisted before the refresh, which re-derives the set from the
      // files.
      this.treeExpanded.add(parentId);
      await this.persistExpandedState(parentId, true);
    }
    showToast({
      doc: this.doc,
      message:
        parentId === null
          ? `Task #${task.id} created.`
          : `Task #${task.id} created as a child of task #${parentId}.`,
      kind: 'success',
    });
    await this.refresh();
  }

  private async updateTask(task: Task, taskInput: TaskInput): Promise<void> {
    const store = this.store;
    if (store === null) {
      throw new Error('No project selected');
    }
    const path = this.pathOfTask(task.id);
    const current = await store.readTask(path);
    const updated = applyTaskInput(current, taskInput, new Date());
    await store.writeTask(path, updated);
    showToast({ doc: this.doc, message: `Task #${task.id} updated.`, kind: 'success' });
    await this.refresh();
  }

  private async deleteTask(task: Task): Promise<void> {
    const store = this.store;
    if (store === null) {
      throw new Error('No project selected');
    }
    await store.deleteFile(this.pathOfTask(task.id));
    showToast({ doc: this.doc, message: `Task #${task.id} deleted.`, kind: 'success' });
    await this.refresh();
  }

  // ---------------------------------------------------------------- notes --

  /**
   * Opens the editor of the thing the toolbar creates.
   *
   * The button of the toolbar creates a task, or a note when the notes are
   * displayed.
   */
  private openCreateFromToolbar(): void {
    if (this.viewMode === 'notes') {
      this.openNoteCreateDialog();
      return;
    }
    this.openCreateDialog();
  }

  /** Opens the editor of a new note. */
  private openNoteCreateDialog(): void {
    if (!this.hasProject()) {
      this.reportMissingProject();
      return;
    }
    const dialog = new NoteDialog({
      doc: this.doc,
      mode: 'create',
      onSave: async (noteInput: NoteInput) => {
        await this.createNote(noteInput);
      },
    });
    dialog.open();
  }

  /** Opens the read only view of a note. */
  private openNoteViewDialog(note: Note): void {
    const dialog = new NoteDialog({
      doc: this.doc,
      mode: 'view',
      note,
      onSave: async () => {
        // The read only view never saves.
      },
      onDelete: async () => {
        await this.deleteNote(note);
      },
      onEdit: () => {
        this.openNoteEditDialog(note);
      },
    });
    dialog.open();
  }

  /** Opens the editor of a note. */
  private openNoteEditDialog(note: Note): void {
    const dialog = new NoteDialog({
      doc: this.doc,
      mode: 'edit',
      note,
      onSave: async (noteInput: NoteInput) => {
        await this.updateNote(note, noteInput);
      },
      onDelete: async () => {
        await this.deleteNote(note);
      },
    });
    dialog.open();
  }

  /** Opens the editor of a note, in read only mode, to delete it. */
  private openNoteDeleteDialog(note: Note): void {
    const dialog = new NoteDialog({
      doc: this.doc,
      mode: 'view',
      note,
      onSave: async () => {
        // The read only view never saves.
      },
      onDelete: async () => {
        await this.deleteNote(note);
      },
    });
    dialog.open();
  }

  /** Creates a note file. */
  private async createNote(noteInput: NoteInput): Promise<void> {
    const store = this.store;
    if (store === null) {
      throw new Error('No project selected');
    }
    const id = await store.nextNoteId();
    const note = buildNote(noteInput, id, new Date());
    await store.createNoteFile(store.notePath(id), note);
    showToast({ doc: this.doc, message: `Note #${note.id} created.`, kind: 'success' });
    await this.refresh();
  }

  /** Changes the title and the body of a note. */
  private async updateNote(note: Note, noteInput: NoteInput): Promise<void> {
    const store = this.store;
    if (store === null) {
      throw new Error('No project selected');
    }
    const path = this.pathOfNote(note.id);
    const current = await store.readNote(path);
    const updated = applyNoteInput(current, noteInput, new Date());
    await store.writeNote(path, updated);
    showToast({ doc: this.doc, message: `Note #${note.id} updated.`, kind: 'success' });
    await this.refresh();
  }

  /** Deletes a note file. */
  private async deleteNote(note: Note): Promise<void> {
    const store = this.store;
    if (store === null) {
      throw new Error('No project selected');
    }
    await store.deleteFile(this.pathOfNote(note.id));
    showToast({ doc: this.doc, message: `Note #${note.id} deleted.`, kind: 'success' });
    await this.refresh();
  }

  /** The path of the file of a note, relative to the project folder. */
  private pathOfNote(noteId: number): string {
    return this.store?.notePath(noteId) ?? `note_${noteId}.txt`;
  }

  // ---------------------------------------------------------------- token --

  private readStoredToken(): string | null {
    if (this.storage === undefined) {
      return null;
    }
    try {
      const value = this.storage.getItem(this.tokenStorageKey);
      return value !== null && value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }

  private storeToken(token: string): void {
    this.token = token;
    this.api.setToken(token);
    try {
      this.storage?.setItem(this.tokenStorageKey, token);
    } catch {
      // The browser refuses to persist the token: it is still used for this session.
    }
  }

  private openTokenDialog(): void {
    const tokenInput = input(this.doc, {
      class: 'field-input',
      id: 'token-input',
      type: 'password',
      value: this.token ?? '',
      placeholder: 'Paste the API token printed by the service',
      onKeyDown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          save();
        }
      },
    });

    const save = (): void => {
      const value = tokenInput.value.trim();
      if (value.length === 0) {
        errorLabel.textContent = 'The token cannot be empty.';
        return;
      }
      this.storeToken(value);
      tokenModal.close();
      void (async () => {
        await this.checkService();
        await this.loadConfig();
        await this.refresh();
      })();
    };

    const errorLabel = el(this.doc, 'div', { class: 'form-error' });

    const tokenModal = new Modal({
      doc: this.doc,
      title: 'API token',
      className: 'token-dialog',
    });
    tokenModal.setBody([
      el(this.doc, 'p', {
        class: 'dialog-help',
        text: 'The Gnumarus OS Bridge service prints a token when it starts. It is required by every endpoint except the help page.',
      }),
      el(this.doc, 'label', { class: 'field', attrs: { for: 'token-input' } }, [
        el(this.doc, 'span', { class: 'field-label', text: 'Token' }),
        tokenInput,
      ]),
      errorLabel,
    ]);
    tokenModal.setFooter([
      el(this.doc, 'div', { class: 'dialog-footer-buttons' }, [
        button(this.doc, 'Cancel', {
          class: 'secondary',
          onClick: () => {
            tokenModal.close();
          },
        }),
        button(this.doc, 'Save', {
          class: 'primary',
          onClick: save,
        }),
      ]),
    ]);
    tokenModal.open();
  }

  private readonly handleGlobalKeyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    const isTyping = isTextEntry(target);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      this.searchInput.focus();
      this.searchInput.select();
      return;
    }
    if (!isTyping && event.key === '/' && this.hasProject()) {
      event.preventDefault();
      this.searchInput.focus();
    }
  };
}

/**
 * True when the event target is a text entry.
 *
 * The check is done on the tag name instead of `instanceof` so the code also
 * works with the DOM implementation of a test environment.
 */
function isTextEntry(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') {
    return false;
  }
  const tagName = (target as { tagName?: unknown }).tagName;
  if (typeof tagName !== 'string') {
    return false;
  }
  const name = tagName.toUpperCase();
  return name === 'INPUT' || name === 'TEXTAREA' || name === 'SELECT';
}

/**
 * Shortens a long path for the top bar, keeping the most relevant part (the
 * end of the path) visible.
 */
export function shortenPath(path: string, maximumLength: number): string {
  if (path.length <= maximumLength) {
    return path;
  }
  return `…${path.slice(path.length - maximumLength + 1)}`;
}
