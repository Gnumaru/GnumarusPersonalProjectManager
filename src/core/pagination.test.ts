import { describe, expect, it } from 'vite-plus/test';
import {
  clampPage,
  computePageInfo,
  DEFAULT_PAGE_SIZE,
  pageSlice,
  totalPages,
} from './pagination.js';

describe('totalPages', () => {
  it('divides the items in pages of the requested size', () => {
    expect(totalPages(0, 10)).toBe(1);
    expect(totalPages(1, 10)).toBe(1);
    expect(totalPages(10, 10)).toBe(1);
    expect(totalPages(11, 10)).toBe(2);
    expect(totalPages(25, 10)).toBe(3);
  });

  it('always keeps at least one page', () => {
    expect(totalPages(0, 0)).toBe(1);
    expect(totalPages(-5, 10)).toBe(1);
  });
});

describe('clampPage', () => {
  it('keeps the page inside the range', () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(-3, 5)).toBe(1);
    expect(clampPage(3, 5)).toBe(3);
    expect(clampPage(9, 5)).toBe(5);
    expect(clampPage(Number.NaN, 5)).toBe(1);
  });
});

describe('computePageInfo', () => {
  it('describes the first page', () => {
    const info = computePageInfo(1, 10, 25);
    expect(info.page).toBe(1);
    expect(info.pageSize).toBe(10);
    expect(info.totalItems).toBe(25);
    expect(info.totalPages).toBe(3);
    expect(info.firstItemIndex).toBe(1);
    expect(info.lastItemIndex).toBe(10);
    expect(info.hasPrevious).toBe(false);
    expect(info.hasNext).toBe(true);
  });

  it('describes a middle page', () => {
    const info = computePageInfo(2, 10, 25);
    expect(info.firstItemIndex).toBe(11);
    expect(info.lastItemIndex).toBe(20);
    expect(info.hasPrevious).toBe(true);
    expect(info.hasNext).toBe(true);
  });

  it('describes the last page', () => {
    const info = computePageInfo(3, 10, 25);
    expect(info.firstItemIndex).toBe(21);
    expect(info.lastItemIndex).toBe(25);
    expect(info.hasPrevious).toBe(true);
    expect(info.hasNext).toBe(false);
  });

  it('describes an empty listing', () => {
    const info = computePageInfo(1, 10, 0);
    expect(info.totalPages).toBe(1);
    expect(info.firstItemIndex).toBe(0);
    expect(info.lastItemIndex).toBe(0);
    expect(info.hasNext).toBe(false);
    expect(info.hasPrevious).toBe(false);
  });

  it('clamps a page that is out of range', () => {
    expect(computePageInfo(99, 10, 25).page).toBe(3);
  });

  it('uses ten tasks per page by default', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(10);
  });
});

describe('pageSlice', () => {
  const items = Array.from({ length: 25 }, (_, index) => index + 1);

  it('returns the items of the requested page', () => {
    expect(pageSlice(items, 1, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(pageSlice(items, 3, 10)).toEqual([21, 22, 23, 24, 25]);
  });

  it('clamps the page number', () => {
    expect(pageSlice(items, 0, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(pageSlice(items, 12, 10)).toEqual([21, 22, 23, 24, 25]);
  });

  it('returns nothing for an invalid page size', () => {
    expect(pageSlice(items, 1, 0)).toEqual([]);
  });
});
