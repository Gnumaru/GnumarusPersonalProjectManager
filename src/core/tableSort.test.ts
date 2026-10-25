import { describe, expect, it } from 'vite-plus/test';
import { nextSortState, sortRows, type SortState } from './tableSort.js';

describe('nextSortState', () => {
  it('sorts a new column descending at the first click', () => {
    expect(nextSortState(null, 'id')).toEqual({ field: 'id', direction: 'desc' });
    expect(nextSortState({ field: 'title', direction: 'asc' }, 'id')).toEqual({
      field: 'id',
      direction: 'desc',
    });
  });

  it('inverts the direction on the next click of the same column', () => {
    const descending = nextSortState(null, 'id');
    expect(nextSortState(descending, 'id')).toEqual({ field: 'id', direction: 'asc' });
    expect(nextSortState({ field: 'id', direction: 'asc' }, 'id')).toEqual({
      field: 'id',
      direction: 'desc',
    });
  });
});

interface Row {
  readonly id: number;
  readonly title: string;
  readonly updated: string;
  readonly parent: number | null;
}

const rows: Row[] = [
  { id: 2, title: 'banana', updated: '20260102000000000', parent: null },
  { id: 1, title: 'apple', updated: '20260211000000000', parent: 5 },
  { id: 10, title: 'Apricot', updated: '20260105120000000', parent: 7 },
  { id: 3, title: 'Cherry', updated: '20260202000000000', parent: null },
];

describe('sortRows', () => {
  it('sorts numbers numerically, descending at the start', () => {
    const state: SortState = { field: 'id', direction: 'desc' };
    expect(sortRows(rows, state, (row) => row.id, 'number').map((row) => row.id)).toEqual([10, 3, 2, 1]);
    expect(
      sortRows(rows, { field: 'id', direction: 'asc' }, (row) => row.id, 'number').map((row) => row.id),
    ).toEqual([1, 2, 3, 10]);
  });

  it('sorts strings alphabetically, case insensitively', () => {
    expect(
      sortRows(rows, { field: 'title', direction: 'desc' }, (row) => row.title.toLowerCase(), 'string').map(
        (row) => row.id,
      ),
    ).toEqual([3, 2, 10, 1]);
  });

  it('sorts dates by their moment, whatever the stored format', () => {
    expect(
      sortRows(rows, { field: 'updated', direction: 'desc' }, (row) => row.updated, 'date').map(
        (row) => row.id,
      ),
    ).toEqual([1, 3, 10, 2]);
    const isoFormat: Row[] = [
      { id: 1, title: 'a', updated: '2026-02-02T10:00:00.000Z', parent: null },
      { id: 2, title: 'b', updated: '20260211000000000', parent: null },
      { id: 3, title: 'c', updated: '20260105090000000', parent: null },
    ];
    expect(
      sortRows(isoFormat, { field: 'updated', direction: 'asc' }, (row) => row.updated, 'date').map(
        (row) => row.id,
      ),
    ).toEqual([3, 1, 2]);
  });

  it('sorts the rows without a value before the ones with one', () => {
    // Descending: the tasks without a parent (2 and 3) come first, then the
    // parent 7 before the parent 5.
    expect(
      sortRows(rows, { field: 'parent', direction: 'desc' }, (row) => row.parent, 'number').map(
        (row) => row.id,
      ),
    ).toEqual([2, 3, 10, 1]);
  });

  it('never modifies the input array and keeps tied rows in place', () => {
    const originals = [...rows];
    const sorted = sortRows(
      rows,
      { field: 'parent', direction: 'asc' },
      (row) => row.parent,
      'number',
    );
    expect(rows).toEqual(originals);
    expect(sorted).not.toBe(rows);
    // Ascending: the parents 5 then 7, and the rows 2 and 3 (both without a
    // parent) tie and keep their original order.
    expect(sorted.map((row) => row.id)).toEqual([2, 3, 1, 10]);
  });
});
