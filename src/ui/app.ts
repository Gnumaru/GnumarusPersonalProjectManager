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
import { TaskRepository, extractTaskIds, type TaskHierarchy } from '../core/taskRepository.js';
import {
  ancestorsOf,
  buildTaskTree,
  flattenTaskTree,
  type TaskTree,
  type TreeRow,
} from '../core/taskTree.js';
import type { Task, TaskInput } from '../core/task.js';
import { button, clear, el, input, type Child } from './dom.js';
import { FileDialog } from './fileDialog.js';
import { createIcon } from './icons.js';
import { Modal } from './modal.js';
import { renderPaginationBar } from './paginationBar.js';
import { TaskDialog } from './taskDialog.js';
import { renderTaskRows } from './taskTable.js';
import { renderTreeRows } from './taskTreeView.js';
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

/** The two ways the tasks can be displayed. */
export type ViewMode = 'list' | 'tree';

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
  private tableWrapElement!: HTMLElement;
  private treeWrapElement!: HTMLElement;
  private treeHeaderElement!: HTMLElement;
  private treeRowsElement!: HTMLElement;
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

    const viewToggle = el(
      this.doc,
      'div',
      { class: 'view-toggle', attrs: { role: 'group', 'aria-label': 'The way the tasks are displayed' } },
      [this.listViewButton, this.treeViewButton],
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

    const content = el(this.doc, 'main', { class: 'content' }, [
      this.tableWrapElement,
      this.treeWrapElement,
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
    const isTree = this.viewMode === 'tree';
    this.tableWrapElement.toggleAttribute('hidden', isTree);
    this.treeWrapElement.toggleAttribute('hidden', !isTree);
    this.paginationElement.toggleAttribute('hidden', isTree);
    if (isTree) {
      this.renderTree();
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
      onToggle: (id) => {
        void this.toggleTreeNode(id);
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

  /**
   * Draws the header of the tree: the chain of the tasks the tree is focused
   * on, from the general root down to the focused task.
   */
  private renderTreeHeader(): void {
    clear(this.treeHeaderElement);

    const generalRoot = el(this.doc, 'button', {
      class: 'tree-crumb',
      text: 'General root',
      title: 'Show every task that has no parent',
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
    this.listViewButton.setAttribute('aria-pressed', this.viewMode === 'list' ? 'true' : 'false');
    this.treeViewButton.setAttribute('aria-pressed', this.viewMode === 'tree' ? 'true' : 'false');
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

  /** Collapses or expands the children of a task of the tree. */
  private async toggleTreeNode(id: number): Promise<void> {
    if (this.treeExpanded.has(id)) {
      this.treeExpanded.delete(id);
    } else {
      this.treeExpanded.add(id);
    }
    await this.updateTree();
  }

  /** Recomputes the tree and draws it again. */
  private async updateTree(): Promise<void> {
    this.setBusy(true);
    try {
      await this.updateTreeRows();
      this.renderCurrentView();
    } catch (error) {
      this.handleError(error);
    } finally {
      this.setBusy(false);
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
    const projectDir = this.config.projectDir;
    if (projectDir === null) {
      return;
    }
    try {
      const path = this.repository.taskPath(projectDir, id);
      const task = await this.repository.loadTask(path);
      await this.openViewDialog(task);
    } catch (error) {
      this.handleError(error);
    }
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
