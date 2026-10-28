import { describe, expect, it } from 'vite-plus/test';
import {
  ancestorsOf,
  buildTaskTree,
  childrenOf,
  flattenTaskTree,
  parentOf,
  subtreeOf,
  visibleTreeRows,
} from './taskTree.js';

function hierarchy(entries: readonly (readonly [number, number | null])[]): Map<number, number | null> {
  return new Map(entries);
}

const EMPTY = new Set<number>();

describe('buildTaskTree', () => {
  it('finds the tasks without a parent', () => {
    const tree = buildTaskTree(
      hierarchy([
        [1, null],
        [2, 1],
        [3, 2],
        [4, null],
      ]),
    );

    expect(tree.roots).toEqual([1, 4]);
    expect(childrenOf(tree, 1)).toEqual([2]);
    expect(childrenOf(tree, 2)).toEqual([3]);
    expect(childrenOf(tree, 3)).toEqual([]);
    expect(parentOf(tree, 3)).toBe(2);
    expect(parentOf(tree, 1)).toBeNull();
  });

  it('sorts the roots and the children by id', () => {
    const tree = buildTaskTree(
      hierarchy([
        [7, null],
        [2, null],
        [9, 7],
        [5, 7],
      ]),
    );

    expect(tree.roots).toEqual([2, 7]);
    expect(childrenOf(tree, 7)).toEqual([5, 9]);
  });

  it('treats a task whose parent does not exist as a root', () => {
    const tree = buildTaskTree(
      hierarchy([
        [1, null],
        [2, 99],
      ]),
    );

    expect(tree.roots).toEqual([1, 2]);
    expect(parentOf(tree, 2)).toBeNull();
  });

  it('treats a task that is its own parent as a root', () => {
    const tree = buildTaskTree(hierarchy([[5, 5]]));

    expect(tree.roots).toEqual([5]);
  });

  it('breaks a cycle between two tasks', () => {
    const tree = buildTaskTree(
      hierarchy([
        [1, 2],
        [2, 1],
      ]),
    );

    // One of the two becomes a root: the tree is always displayable.
    expect(tree.roots).toHaveLength(1);
    const rows = flattenTaskTree(tree, { focusId: null, expanded: new Set([1, 2]) });
    expect(rows.map((row) => row.id).sort()).toEqual([1, 2]);
  });
});

describe('ancestorsOf', () => {
  it('gives the chain of the parents, from the root down', () => {
    const tree = buildTaskTree(
      hierarchy([
        [1, null],
        [2, 1],
        [3, 2],
      ]),
    );

    expect(ancestorsOf(tree, 3)).toEqual([1, 2]);
    expect(ancestorsOf(tree, 1)).toEqual([]);
  });
});

describe('subtreeOf', () => {
  it('gives a task and all its descendants', () => {
    const tree = buildTaskTree(
      hierarchy([
        [1, null],
        [2, 1],
        [3, 2],
        [4, 1],
        [5, null],
      ]),
    );

    expect(subtreeOf(tree, 1).sort()).toEqual([1, 2, 3, 4]);
    expect(subtreeOf(tree, 2).sort()).toEqual([2, 3]);
    expect(subtreeOf(tree, 3)).toEqual([3]);
    expect(subtreeOf(tree, 5)).toEqual([5]);
    expect(subtreeOf(tree, 99)).toEqual([]);
  });

  it('never loops on a cycle', () => {
    const cyclic = buildTaskTree(
      hierarchy([
        [1, 2],
        [2, 3],
        [3, 1],
      ]),
    );

    expect(subtreeOf(cyclic, 1).length).toBeLessThanOrEqual(3);
  });
});

describe('flattenTaskTree', () => {
  const tree = buildTaskTree(
    hierarchy([
      [1, null],
      [2, 1],
      [3, 1],
      [4, 2],
      [5, null],
    ]),
  );

  it('shows the tasks without a parent when the focus is the general root', () => {
    const rows = flattenTaskTree(tree, { focusId: null, expanded: EMPTY });

    expect(rows.map((row) => row.id)).toEqual([1, 5]);
    expect(rows[0]?.depth).toBe(0);
    expect(rows[0]?.hasChildren).toBe(true);
    expect(rows[0]?.expanded).toBe(false);
    expect(rows[1]?.hasChildren).toBe(false);
  });

  it('shows the children of the expanded tasks', () => {
    const rows = flattenTaskTree(tree, { focusId: null, expanded: new Set([1]) });

    expect(rows.map((row) => row.id)).toEqual([1, 2, 3, 5]);
    expect(rows[1]?.depth).toBe(1);
    expect(rows[2]?.depth).toBe(1);
  });

  it('shows the children of the expanded tasks, at the right depth', () => {
    const rows = flattenTaskTree(tree, { focusId: null, expanded: new Set([1, 2]) });

    expect(rows.map((row) => row.id)).toEqual([1, 2, 4, 3, 5]);
    expect(rows.find((row) => row.id === 4)?.depth).toBe(2);
  });

  it('makes the focused task the root of the displayed tree', () => {
    const rows = flattenTaskTree(tree, { focusId: 2, expanded: new Set([2]) });

    expect(rows.map((row) => row.id)).toEqual([2, 4]);
    expect(rows[0]?.depth).toBe(0);
    expect(rows[1]?.depth).toBe(1);
  });

  it('hides the tasks that are not part of the hierarchy of the focused task', () => {
    const rows = flattenTaskTree(tree, { focusId: 2, expanded: EMPTY });

    expect(rows.map((row) => row.id)).toEqual([2]);
  });

  it('falls back to the general root when the focused task does not exist', () => {
    const rows = flattenTaskTree(tree, { focusId: 99, expanded: EMPTY });

    expect(rows.map((row) => row.id)).toEqual([1, 5]);
  });

  it('shows only the branches that hold a match and expands their ancestors', () => {
    const rows = flattenTaskTree(tree, {
      focusId: null,
      expanded: EMPTY,
      matches: new Set([4]),
    });

    // The task 4 is a grand child: its ancestors are shown and expanded.
    expect(rows.map((row) => row.id)).toEqual([1, 2, 4]);
    expect(rows[0]?.expanded).toBe(true);
    expect(rows[1]?.expanded).toBe(true);
    expect(rows[2]?.hasChildren).toBe(false);
  });

  it('shows nothing when no task matches', () => {
    const rows = flattenTaskTree(tree, {
      focusId: null,
      expanded: EMPTY,
      matches: new Set<number>(),
    });

    expect(rows).toHaveLength(0);
  });

  it('hides the focused task when it does not hold any match', () => {
    const rows = flattenTaskTree(tree, {
      focusId: 5,
      expanded: EMPTY,
      matches: new Set([4]),
    });

    expect(rows).toHaveLength(0);
  });

  it('never loops on a cycle', () => {
    const cyclic = buildTaskTree(
      hierarchy([
        [1, 2],
        [2, 3],
        [3, 1],
      ]),
    );

    const rows = flattenTaskTree(cyclic, {
      focusId: null,
      expanded: new Set([1, 2, 3]),
    });

    expect(rows.length).toBeLessThanOrEqual(3);
  });
});

describe('visibleTreeRows', () => {
  function rows(): ReturnType<typeof flattenTaskTree> {
    const tree = buildTaskTree(
      hierarchy([
        [1, null],
        [2, 1],
        [3, 2],
        [4, 1],
        [5, null],
      ]),
    );
    return flattenTaskTree(tree, { focusId: null, expanded: new Set([1, 2]) });
  }

  it('keeps every row when nothing is hidden', () => {
    expect(rows().map((row) => row.id)).toEqual([1, 2, 3, 4, 5]);
    expect(visibleTreeRows(rows(), new Set()).map((row) => row.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('drops a hidden row with its whole subtree', () => {
    expect(visibleTreeRows(rows(), new Set([2])).map((row) => row.id)).toEqual([1, 4, 5]);
  });

  it('drops a hidden root with its whole subtree', () => {
    expect(visibleTreeRows(rows(), new Set([1])).map((row) => row.id)).toEqual([5]);
  });

  it('keeps the siblings of a hidden leaf', () => {
    expect(visibleTreeRows(rows(), new Set([4])).map((row) => row.id)).toEqual([1, 2, 3, 5]);
  });
});
