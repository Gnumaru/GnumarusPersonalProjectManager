/**
 * Pure pagination helpers.
 *
 * The application keeps only the tasks of the current page in memory, so the
 * repository resolves the matching file paths first and slices the page out of
 * them before reading any file.
 */

export const DEFAULT_PAGE_SIZE = 10;

export interface PageInfo {
  /** 1 based page number. */
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
  /** 1 based index of the first item shown on the page, `0` when the page is empty. */
  readonly firstItemIndex: number;
  /** 1 based index of the last item shown on the page, `0` when the page is empty. */
  readonly lastItemIndex: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
}

/** Number of pages needed to show `totalItems` items, at least one. */
export function totalPages(totalItems: number, pageSize: number): number {
  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    return 1;
  }
  const safeTotal = Number.isFinite(totalItems) && totalItems > 0 ? totalItems : 0;
  return Math.max(1, Math.ceil(safeTotal / pageSize));
}

/** Keeps a page number inside the `1 .. totalPages` range. */
export function clampPage(page: number, totalPagesCount: number): number {
  const max = Math.max(1, totalPagesCount);
  if (!Number.isFinite(page)) {
    return 1;
  }
  const truncated = Math.trunc(page);
  if (truncated < 1) {
    return 1;
  }
  return Math.min(truncated, max);
}

/** Computes every piece of information the pagination bar needs. */
export function computePageInfo(page: number, pageSize: number, totalItems: number): PageInfo {
  const pages = totalPages(totalItems, pageSize);
  const current = clampPage(page, pages);
  const safeTotal = Number.isFinite(totalItems) && totalItems > 0 ? Math.trunc(totalItems) : 0;
  const firstItemIndex = safeTotal === 0 ? 0 : (current - 1) * pageSize + 1;
  const lastItemIndex = safeTotal === 0 ? 0 : Math.min(current * pageSize, safeTotal);

  return {
    page: current,
    pageSize,
    totalItems: safeTotal,
    totalPages: pages,
    firstItemIndex,
    lastItemIndex,
    hasPrevious: current > 1,
    hasNext: current < pages,
  };
}

/** Returns the items of the requested page (1 based page number). */
export function pageSlice<T>(items: readonly T[], page: number, pageSize: number): T[] {
  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    return [];
  }
  const pages = totalPages(items.length, pageSize);
  const current = clampPage(page, pages);
  const start = (current - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
