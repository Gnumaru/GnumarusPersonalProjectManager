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
import { loadConfig, saveConfig, type AppConfig } from '../core/config.js';
import { DEFAULT_PAGE_SIZE, computePageInfo, type PageInfo } from '../core/pagination.js';
import { TaskRepository, extractTaskIds, joinPath, type TaskHierarchy, type TaskMetadata } from '../core/taskRepository.js';
import { commentFileName, type TaskComment } from '../core/comment.js';
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
  buildSchedule,
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
  type Task,
  type TaskCard,
  type TaskInput,
  type TaskStatus,
} from '../core/task.js';
import { button, clear, el, input, type Child } from './dom.js';
import { FileDialog } from './fileDialog.js';
import { renderGanttView, type GanttTask } from './ganttView.js';
import { GanttDragController, type GanttDragContext } from './ganttDrag.js';
import { createIcon } from './icons.js';
import { KanbanDragController } from './kanbanDrag.js';
import { renderKanbanBoard } from './kanbanBoard.js';
import { Modal } from './modal.js';
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
export interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type ServiceState = 'checking' | 'online' | 'offline' | 'unauthorized';

/** The four ways the tasks can be displayed. */
export type ViewMode = 'list' | 'tree' | 'kanban' | 'gantt';

export interface AppOptions {
  readonly doc: Document;
  readonly root: HTMLElement;
  readonly api?: ApiClient;
  readonly storage?: TokenStorage;
  readonly tokenStorageKey?: string;
}

const SERVICE_CHECK_INTERVAL_MS = 5000;

/** Amount of task files read at the same time when the tree is drawn. */
const TREE_READ_CONCURRENCY = 8;

export class App {
  private readonly doc: Document;
  private readonly root: HTMLElement;
  private readonly api: ApiClient;
  private readonly repository: TaskRepository;
  private readonly storage: TokenStorage | undefined;
  private readonly tokenStorageKey: string;

  private token: string | null = null;
  /**
   * Whether the service demands a token.
   *
   * `false` when the service was started without the token requirement: the
   * application then works without a token and never asks the user for one.
   * `null` when the policy could not be determined.
   */
  private authRequired: boolean | null = null;
  private config: AppConfig = { projectDir: null, pageSize: DEFAULT_PAGE_SIZE };
  private query = '';
  private page = 1;
  private pageSize = DEFAULT_PAGE_SIZE;
  private tasks: Task[] = [];
  private info: PageInfo = computePageInfo(1, DEFAULT_PAGE_SIZE, 0);
  private childCounts = new Map<number, number>();
  private serviceState: ServiceState = 'checking';

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
  /** The cards of the board: the tasks that have no child. */
  private kanbanCards: TaskCard[] = [];
  /** The metadata of the tasks, read for the Gantt chart. */
  private ganttMetadata = new Map<number, TaskMetadata>();
  /** The weeks and the months that are collapsed in the Gantt chart. */
  private ganttCollapsed = new Set<string>();
  /** The schedule of the chart currently drawn. */
  private ganttScheduleState: GanttSchedule | null = null;
  /** The columns of the chart currently drawn. */
  private ganttLayoutState: GanttLayout | null = null;

  private projectPathElement!: HTMLElement;
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
  private tableWrapElement!: HTMLElement;
  private treeWrapElement!: HTMLElement;
  private treeHeaderElement!: HTMLElement;
  private treeRowsElement!: HTMLElement;
  private kanbanElement!: HTMLElement;
  private ganttElement!: HTMLElement;
  private ganttChartElement!: HTMLElement;
  private ganttDrag: GanttDragController | null = null;
  private treeDrag: TreeDragController | null = null;
  private kanbanDrag: KanbanDragController | null = null;
  private rowsElement!: HTMLTableSectionElement;
  private emptyStateElement!: HTMLElement;
  private paginationElement!: HTMLElement;
  private resultCountElement!: HTMLElement;

  private checkTimer: number | null = null;

  constructor(options: AppOptions) {
    this.doc = options.doc;
    this.root = options.root;
    this.api = options.api ?? new ApiClient();
    this.repository = new TaskRepository(this.api);
    this.storage = options.storage;
    this.tokenStorageKey = options.tokenStorageKey ?? TOKEN_STORAGE_KEY;
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

    this.setServiceState('checking');
    await this.checkService();

    await this.loadConfig();
    await this.refresh();

    this.startServiceWatch();
    this.doc.addEventListener('keydown', this.handleGlobalKeyDown);
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
        this.openCreateDialog();
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

    const viewToggle = el(
      this.doc,
      'div',
      { class: 'view-toggle', attrs: { role: 'group', 'aria-label': 'The way the tasks are displayed' } },
      [this.listViewButton, this.treeViewButton, this.kanbanViewButton, this.ganttViewButton],
    );

    const toolbar = el(this.doc, 'div', { class: 'toolbar' }, [
      el(this.doc, 'div', { class: 'search-box' }, [this.searchInput, searchButton, this.clearSearchButton]),
      el(this.doc, 'div', { class: 'toolbar-right' }, [
        viewToggle,
        this.resultCountElement,
        this.newTaskButton,
      ]),
    ]);

    this.rowsElement = this.doc.createElement('tbody');
    this.emptyStateElement = el(this.doc, 'div', { class: 'empty-state', attrs: { hidden: 'hidden' } });

    const table = el(this.doc, 'table', { class: 'task-table' }, [
      el(this.doc, 'thead', {}, [
        el(this.doc, 'tr', {}, [
          el(this.doc, 'th', { class: 'cell-id', text: 'ID' }),
          el(this.doc, 'th', { class: 'cell-title', text: 'Title' }),
          el(this.doc, 'th', { class: 'cell-parent', text: 'Parent' }),
          el(this.doc, 'th', { class: 'cell-tags', text: 'Tags' }),
          el(this.doc, 'th', { class: 'cell-status', text: 'Status' }),
          el(this.doc, 'th', { class: 'cell-updated', text: 'Updated' }),
          el(this.doc, 'th', { class: 'cell-actions' }),
        ]),
      ]),
      this.rowsElement,
    ]);

    this.tableWrapElement = el(this.doc, 'div', { class: 'table-wrap' }, [table]);
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
      this.treeWrapElement,
      this.kanbanElement,
      this.ganttElement,
      this.emptyStateElement,
    ]);

    this.paginationElement = el(this.doc, 'footer', { class: 'pagination-footer' });

    this.root.append(topbar, this.bannerElement, toolbar, content, this.paginationElement);
  }

  // -------------------------------------------------------------- service --

  private async checkService(): Promise<void> {
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
    const tokenIsUseless = this.authRequired === false;
    this.tokenButton.toggleAttribute('hidden', tokenIsUseless);
    this.servicePillElement.title =
      this.authRequired === false
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
    this.serviceTextElement.textContent = labels[state];

    if (state === 'offline') {
      this.showBanner(
        'The Gnumarus OS Bridge service is not reachable. The application retries automatically every few seconds.',
        'error',
      );
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
    this.config = await loadConfig(this.api);
    this.pageSize = this.config.pageSize;
    this.updateProjectPath();
  }

  private async persistConfig(): Promise<void> {
    try {
      await saveConfig(this.api, { projectDir: this.config.projectDir, pageSize: this.pageSize });
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
    if (projectDir === null) {
      this.projectPathElement.textContent = 'No folder selected';
      this.projectPathElement.title = '';
      return;
    }
    this.projectPathElement.textContent = shortenPath(projectDir, 52);
    this.projectPathElement.title = projectDir;
  }

  // ---------------------------------------------------------------- tasks --

  private async refresh(): Promise<void> {
    const projectDir = this.config.projectDir;
    if (projectDir === null) {
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
        await this.refreshTree(projectDir);
      } else if (this.viewMode === 'kanban') {
        await this.refreshKanban(projectDir);
      } else if (this.viewMode === 'gantt') {
        await this.refreshGantt(projectDir);
      } else {
        await this.refreshList(projectDir);
      }
      this.setServiceState('online');
      this.renderCurrentView();
    } catch (error) {
      this.handleError(error);
    } finally {
      this.setBusy(false);
    }
  }

  /** Loads one page of the flat list of the tasks. */
  private async refreshList(projectDir: string): Promise<void> {
    const [page, childCounts] = await Promise.all([
      this.repository.getPage(projectDir, {
        page: this.page,
        pageSize: this.pageSize,
        query: this.query,
      }),
      this.repository.childCounts(projectDir).catch(() => new Map<number, number>()),
    ]);
    this.tasks = [...page.tasks];
    this.info = page.info;
    this.page = page.info.page;
    this.childCounts = childCounts;
  }

  /**
   * Reads the structure of the tasks and the tasks that are displayed.
   *
   * The hierarchy is read with a single `grep` of the `parent=` lines: the
   * content of the files never reaches the browser here.
   */
  private async refreshTree(projectDir: string): Promise<void> {
    const hierarchy = await this.repository.readHierarchy(projectDir);
    this.treeHierarchy = hierarchy;
    this.treeStructure = buildTaskTree(hierarchy.parents);

    if (this.query.length > 0) {
      const paths = await this.repository.searchTaskFilePaths(projectDir, this.query);
      this.treeMatches = new Set(extractTaskIds(paths));
    } else {
      this.treeMatches = null;
    }

    await this.updateTreeRows();
  }

  /**
   * Reads the cards of the board.
   *
   * Only the tasks that have **no child** belong to the board: one command
   * reads the parent, the status, the title and the tags of every task.
   */
  private async refreshKanban(projectDir: string): Promise<void> {
    this.kanbanCards = await this.repository.readLeafTasks(projectDir);
  }

  /**
   * Reads the metadata of the tasks for the Gantt chart.
   *
   * One command returns the parent, the status, the title and the dates of
   * every task: the chart needs all of them.
   */
  private async refreshGantt(projectDir: string): Promise<void> {
    const metadata = await this.repository.readTaskMetadata(projectDir);
    this.ganttMetadata = metadata;

    // The chart shows the same tree as the tree view: the structure, the focus
    // and the expansion are shared, so a branch expanded in one view is
    // expanded in the other one.
    const parents = new Map<number, number | null>();
    const paths = new Map<number, string>();
    for (const task of metadata.values()) {
      parents.set(task.id, task.parentId);
      paths.set(task.id, task.path);
    }
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
          loaded.set(id, await this.repository.loadTask(path));
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
    this.treeWrapElement.toggleAttribute('hidden', mode !== 'tree');
    this.kanbanElement.toggleAttribute('hidden', mode !== 'kanban');
    this.ganttElement.toggleAttribute('hidden', mode !== 'gantt');
    this.paginationElement.toggleAttribute('hidden', mode !== 'list');
    if (mode === 'tree') {
      this.renderTree();
    } else if (mode === 'kanban') {
      this.renderKanban();
    } else if (mode === 'gantt') {
      this.renderGantt();
    } else {
      this.renderList();
    }
  }

  /** Draws the flat list of the tasks. */
  private renderList(): void {
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
    }, this.childCounts)) {
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
    })) {
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
      }),
    );

    this.updateEmptyState(this.kanbanCards.length === 0);
    this.resultCountElement.textContent = this.buildResultCount();
    this.updateToolbarState();
  }

  /** Draws the Gantt chart of the tasks. */
  private renderGantt(): void {
    clear(this.ganttElement);

    const rows = this.ganttRows();
    const schedule = this.ganttSchedule();
    if (schedule === null) {
      this.ganttElement.append(
        el(this.doc, 'div', { class: 'gantt-empty', text: 'No task has a start or an end date yet.' }),
      );
      this.updateEmptyState(false);
      this.resultCountElement.textContent = this.buildResultCount();
      this.updateToolbarState();
      return;
    }

    const layout = buildLayout(schedule, this.ganttCollapsed);
    const tasks = this.ganttTasks(rows, layout, schedule);

    this.ganttElement.append(
      renderGanttView(
        {
          doc: this.doc,
          rows,
          tasks,
          schedule,
          layout,
        },
        {
          onToggle: (id, recursive) => {
            void this.toggleTreeNode(id, recursive);
          },
          onOpen: (id) => {
            void this.openTaskById(id);
          },
          onEdit: (id) => {
            void this.openEditTaskById(id);
          },
          onToggleWeek: (key) => {
            this.toggleGanttPeriod(key);
          },
          onToggleMonth: (key) => {
            this.toggleGanttMonth(key);
          },
        },
      ),
    );

    // The drag of the bars needs the chart that is on the screen.
    this.ganttScheduleState = schedule;
    this.ganttLayoutState = layout;
    this.ganttChartElement = this.ganttElement.querySelector<HTMLElement>('.gantt-chart') ?? this.ganttElement;

    this.updateEmptyState(rows.length === 0);
    this.resultCountElement.textContent = this.buildResultCount();
    this.updateToolbarState();
  }

  /** The chart currently drawn, `null` when there is none. */
  private ganttDragContext(): GanttDragContext | null {
    const schedule = this.ganttScheduleState;
    const layout = this.ganttLayoutState;
    if (schedule === null || layout === null || this.ganttChartElement === null) {
      return null;
    }
    return {
      columns: layout.columns,
      schedule,
      chart: this.ganttChartElement,
    };
  }

  /**
   * Changes the start and the end date of a task.
   *
   * The dates are dragged on the chart of the Gantt view.
   */
  private async changeTaskDates(taskId: number, start: string, end: string): Promise<void> {
    const projectDir = this.config.projectDir;
    if (projectDir === null) {
      return;
    }
    const path =
      this.treeHierarchy?.paths.get(taskId) ?? this.repository.taskPath(projectDir, taskId);
    this.setBusy(true);
    try {
      await this.repository.setDates(path, start, end);
      await this.refresh();
    } catch (error) {
      this.handleError(error);
    } finally {
      this.setBusy(false);
    }
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
    });
  }

  /** The days of the schedule, from the dates of the tasks. */
  private ganttSchedule(): GanttSchedule | null {
    let from: Date | null = null;
    let to: Date | null = null;

    for (const task of this.ganttMetadata.values()) {
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
    return buildSchedule(from, to);
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
   * the weeks that hold at least one day of that month.
   */
  private toggleGanttMonth(monthKey: string): void {
    const schedule = this.ganttScheduleState;
    if (schedule === null) {
      return;
    }
    const weeks = schedule.weeks.filter((week) => {
      const date = dayOfIndex(schedule, week.firstDayIndex);
      return isoDate(startOfMonth(date)) === monthKey;
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
    clear(this.treeHeaderElement);

    const generalRoot = el(this.doc, 'button', {
      class: `tree-crumb ${ROOT_TARGET_CLASS}`,
      text: 'General root',
      title: 'Show every task that has no parent (drop a task here to make it a root task)',
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
        crumbs.push(el(this.doc, 'span', { class: 'tree-crumb-sep', text: '›' }));
        const crumb = el(this.doc, 'button', {
          class: 'tree-crumb',
          text: `#${ancestorId}`,
          title: `Focus the tree on the task #${ancestorId}`,
        });
        crumb.type = 'button';
        crumb.addEventListener('click', () => {
          void this.focusTree(ancestorId);
        });
        crumbs.push(crumb);
      }
      crumbs.push(el(this.doc, 'span', { class: 'tree-crumb-sep', text: '›' }));
      const focused = this.treeTasks.get(this.treeFocusId);
      crumbs.push(
        el(this.doc, 'span', {
          class: 'tree-crumb is-active',
          text: focused === undefined ? `#${this.treeFocusId}` : focused.title,
        }),
      );
    }

    this.treeHeaderElement.append(
      el(this.doc, 'span', { class: 'tree-header-label', text: 'Focus' }),
      el(this.doc, 'nav', { class: 'tree-breadcrumb' }, crumbs),
    );
  }

  /** Shows the message of the empty state, when there is nothing to show. */
  private updateEmptyState(isEmpty: boolean): void {
    const hasProject = this.config.projectDir !== null;
    if (!hasProject) {
      this.showEmptyState(
        'Choose the folder that will hold your tasks',
        'Every task is a text file named task_<id>.txt inside that folder.',
        'Choose folder…',
        () => {
          void this.openFolderPicker();
        },
      );
      return;
    }
    if (isEmpty && this.query.length > 0) {
      this.showEmptyState(
        `No task matches "${this.query}"`,
        'Try another search term or clear the search to see every task.',
        'Clear search',
        () => {
          this.applySearch('');
        },
      );
      return;
    }
    if (isEmpty) {
      this.showEmptyState(
        'This folder does not contain any task yet',
        'Create the first task to get started.',
        'New task',
        () => {
          this.openCreateDialog();
        },
      );
      return;
    }
    this.hideEmptyState();
  }

  /** Keeps the state of the toolbar in sync with the current view. */
  private updateToolbarState(): void {
    const hasProject = this.config.projectDir !== null;
    this.clearSearchButton.toggleAttribute('hidden', this.query.length === 0);
    this.newTaskButton.toggleAttribute('disabled', !hasProject);
  }

  private buildResultCount(): string {
    if (this.config.projectDir === null) {
      return '';
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
    await this.refresh();
  }

  private updateViewToggle(): void {
    this.listViewButton.classList.toggle('is-active', this.viewMode === 'list');
    this.treeViewButton.classList.toggle('is-active', this.viewMode === 'tree');
    this.kanbanViewButton.classList.toggle('is-active', this.viewMode === 'kanban');
    this.ganttViewButton.classList.toggle('is-active', this.viewMode === 'gantt');
    this.listViewButton.setAttribute('aria-pressed', this.viewMode === 'list' ? 'true' : 'false');
    this.treeViewButton.setAttribute('aria-pressed', this.viewMode === 'tree' ? 'true' : 'false');
    this.kanbanViewButton.setAttribute('aria-pressed', this.viewMode === 'kanban' ? 'true' : 'false');
    this.ganttViewButton.setAttribute('aria-pressed', this.viewMode === 'gantt' ? 'true' : 'false');
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
      // The focused task shows its children right away.
      this.treeExpanded.add(id);
    }
    await this.updateTree();
  }

  /**
   * Collapses or expands the children of a task of the tree.
   *
   * A simple click only changes the task itself: the state of its children is
   * kept. With the control key the whole branch is collapsed or expanded, the
   * task and every one of its descendants.
   */
  private async toggleTreeNode(id: number, recursive: boolean): Promise<void> {
    const expanded = !this.treeExpanded.has(id);
    if (recursive) {
      this.setSubtreeExpanded(id, expanded);
    } else if (expanded) {
      this.treeExpanded.add(id);
    } else {
      this.treeExpanded.delete(id);
    }
    await this.updateTree();
  }

  /** Collapses or expands a task and all its descendants. */
  private setSubtreeExpanded(id: number, expanded: boolean): void {
    const structure = this.treeStructure;
    if (structure === null) {
      return;
    }
    for (const descendant of subtreeOf(structure, id)) {
      if (expanded) {
        this.treeExpanded.add(descendant);
      } else {
        this.treeExpanded.delete(descendant);
      }
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
    const projectDir = this.config.projectDir;
    if (projectDir === null) {
      return;
    }
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

    const path = this.treeHierarchy?.paths.get(taskId) ?? this.repository.taskPath(projectDir, taskId);
    this.setBusy(true);
    try {
      await this.repository.setParent(path, targetId);
      showToast({
        doc: this.doc,
        message:
          targetId === null
            ? `The task #${taskId} is now a root task.`
            : `The task #${taskId} is now a child of the task #${targetId}.`,
        kind: 'success',
      });
      await this.refresh();
    } catch (error) {
      this.handleError(error);
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * Changes the status of a task.
   *
   * The card is dropped on the column of another status: the `status=` key of
   * its file is rewritten.
   */
  private async changeTaskStatus(taskId: number, status: TaskStatus): Promise<void> {
    const projectDir = this.config.projectDir;
    if (projectDir === null) {
      return;
    }
    const card = this.kanbanCards.find((candidate) => candidate.id === taskId);
    if (card === undefined || card.status === status) {
      // The task is not on the board any more, or it is already there.
      return;
    }
    this.setBusy(true);
    try {
      await this.repository.setStatus(card.path, status);
      showToast({
        doc: this.doc,
        message: `The task #${taskId} is now ${STATUS_LABELS[status]}.`,
        kind: 'success',
      });
      await this.refresh();
    } catch (error) {
      this.handleError(error);
    } finally {
      this.setBusy(false);
    }
  }

  /** Opens the editor of a task that is only known by its id. */
  private async openEditTaskById(id: number): Promise<void> {
    const task = await this.loadTaskById(id);
    if (task === null) {
      return;
    }
    this.openEditDialog(task);
  }

  /** The comments of a task, the most recent first. */
  private async loadTaskComments(taskId: number): Promise<TaskComment[]> {
    const projectDir = this.config.projectDir;
    if (projectDir === null) {
      return [];
    }
    return this.repository.listComments(projectDir, taskId);
  }

  /** Adds a comment to a task. */
  private async addTaskComment(taskId: number, text: string): Promise<void> {
    const projectDir = this.config.projectDir;
    if (projectDir === null) {
      return;
    }
    await this.repository.createComment(projectDir, taskId, text);
  }

  /** Changes the text of a comment. */
  private async updateTaskComment(
    _taskId: number,
    commentId: number,
    text: string,
  ): Promise<void> {
    const projectDir = this.config.projectDir;
    if (projectDir === null) {
      return;
    }
    await this.repository.updateComment(this.commentPath(projectDir, commentId), text);
  }

  /** Deletes a comment of a task. */
  private async deleteTaskComment(_taskId: number, commentId: number): Promise<void> {
    const projectDir = this.config.projectDir;
    if (projectDir === null) {
      return;
    }
    await this.repository.deleteComment(this.commentPath(projectDir, commentId));
  }

  /** The path of the file of a comment. */
  private commentPath(projectDir: string, commentId: number): string {
    return joinPath(projectDir, commentFileName(commentId));
  }

  /** Reads a task from the disk, `null` when it cannot be read. */
  private async loadTaskById(id: number): Promise<Task | null> {
    const projectDir = this.config.projectDir;
    if (projectDir === null) {
      return null;
    }
    const card = this.kanbanCards.find((candidate) => candidate.id === id);
    const path =
      card?.path ?? this.treeHierarchy?.paths.get(id) ?? this.repository.taskPath(projectDir, id);
    try {
      return await this.repository.loadTask(path);
    } catch (error) {
      this.handleError(error);
      return null;
    }
  }

  private applySearch(value: string): void {
    this.query = value.trim();
    this.searchInput.value = value;
    this.page = 1;
    void this.refresh();
  }

  private async goToPage(page: number): Promise<void> {
    if (page === this.page) {
      return;
    }
    this.page = page;
    await this.refresh();
  }

  private async openFolderPicker(): Promise<void> {
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
    await this.refresh();
    showToast({ doc: this.doc, message: `Tasks folder set to ${path}`, kind: 'success' });
  }

  private openCreateDialog(parent?: Task): void {
    if (this.config.projectDir === null) {
      showToast({ doc: this.doc, message: 'Choose a project folder first.', kind: 'error' });
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

  /** The children of a task, loaded from the disk. */
  private async loadChildren(parentId: number): Promise<Task[]> {
    const projectDir = this.config.projectDir;
    if (projectDir === null) {
      return [];
    }
    try {
      return await this.repository.findChildren(projectDir, parentId);
    } catch {
      return [];
    }
  }

  private async createTask(taskInput: TaskInput, parentId: number | null): Promise<void> {
    const projectDir = this.config.projectDir;
    if (projectDir === null) {
      throw new Error('No project folder selected');
    }
    const task = await this.repository.createTask(projectDir, taskInput, parentId);
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
    const projectDir = this.config.projectDir;
    if (projectDir === null) {
      throw new Error('No project folder selected');
    }
    const path = this.repository.taskPath(projectDir, task.id);
    await this.repository.updateTask(path, taskInput);
    showToast({ doc: this.doc, message: `Task #${task.id} updated.`, kind: 'success' });
    await this.refresh();
  }

  private async deleteTask(task: Task): Promise<void> {
    const projectDir = this.config.projectDir;
    if (projectDir === null) {
      throw new Error('No project folder selected');
    }
    const path = this.repository.taskPath(projectDir, task.id);
    await this.repository.deleteTask(path);
    showToast({ doc: this.doc, message: `Task #${task.id} deleted.`, kind: 'success' });
    await this.refresh();
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
    if (!isTyping && event.key === '/' && this.config.projectDir !== null) {
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
