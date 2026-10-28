/**
 * Tree of the tasks, built from the `id -> parent` mapping read on the disk.
 *
 * The module is pure: it knows nothing about the files nor about the low level
 * service. It turns the flat mapping into a forest and flattens that forest
 * into the rows the tree view displays.
 *
 * Two rules keep the tree consistent with what is really on the disk:
 *
 * * a task whose parent does not exist (a deleted parent, a task moved to
 *   another folder) becomes a **root**: it would otherwise be invisible,
 * * a cycle in the `parent=` keys (`a` is the parent of `b` and `b` is the
 *   parent of `a`) is broken: the task that closes the cycle becomes a root.
 */

export interface TaskTree {
  /** Ids of the tasks without a parent, sorted by id. */
  readonly roots: readonly number[];
  /** Ids of the children of every task, sorted by id. */
  readonly children: ReadonlyMap<number, readonly number[]>;
  /** Id of the parent of every task, `null` for a root task. */
  readonly parents: ReadonlyMap<number, number | null>;
}

/** One line of the tree view. */
export interface TreeRow {
  /** Id of the task shown by the row. */
  readonly id: number;
  /** Depth of the row, the root of the displayed tree being at zero. */
  readonly depth: number;
  /** `true` when the task has children that can be shown. */
  readonly hasChildren: boolean;
  /** `true` when the children of the task are shown. */
  readonly expanded: boolean;
}

export interface TreeOptions {
  /** Task the tree is focused on, `null` for the general root. */
  readonly focusId: number | null;
  /** Ids of the tasks whose children are shown. */
  readonly expanded: ReadonlySet<number>;
  /**
   * Ids of the tasks matching the current search.
   *
   * When it is set, only the branches holding a match are shown and the
   * ancestors of the matches are expanded, so a match is never hidden.
   */
  readonly matches?: ReadonlySet<number> | null;
}

/**
 * Builds the tree of the tasks.
 *
 * @param parents id of every task -> id of its parent (`null` for a root task)
 */
export function buildTaskTree(
  parents: ReadonlyMap<number, number | null>,
  orders?: ReadonlyMap<number, number>,
): TaskTree {
  const resolved = new Map<number, number | null>();
  for (const id of parents.keys()) {
    resolved.set(id, null);
  }
  for (const [id, parent] of parents) {
    if (parent === null || parent === id || !resolved.has(parent)) {
      // No parent, a parent that is the task itself or a parent that does not
      // exist: the task stays a root of the forest.
      continue;
    }
    resolved.set(id, parent);
  }
  breakCycles(resolved);

  const children = new Map<number, number[]>();
  const roots: number[] = [];
  for (const [id, parent] of resolved) {
    if (parent === null) {
      roots.push(id);
      continue;
    }
    const list = children.get(parent);
    if (list === undefined) {
      children.set(parent, [id]);
    } else {
      list.push(id);
    }
  }
  const compare = (left: number, right: number): number => {
    const leftOrder = orders?.get(left) ?? 0;
    const rightOrder = orders?.get(right) ?? 0;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left - right;
  };
  roots.sort(compare);
  for (const list of children.values()) {
    list.sort(compare);
  }

  return { roots, children, parents: resolved };
}

/**
 * Flattens the tree into the rows to display.
 *
 * The rows start at the focused task (or at the roots of the forest when the
 * focus is the general root) and follow the children of the expanded tasks.
 */
export function flattenTaskTree(tree: TaskTree, options: TreeOptions): TreeRow[] {
  const matches = options.matches ?? null;
  const keep = matches === null ? null : collectMatchingBranches(tree, matches);
  const autoExpanded = matches === null ? new Set<number>() : collectAncestorsOfMatches(tree, matches);

  const roots = resolveRoots(tree, options.focusId, keep);
  const rows: TreeRow[] = [];
  const path = new Set<number>();

  const visit = (id: number, depth: number): void => {
    const allChildren = tree.children.get(id) ?? [];
    const children = keep === null ? allChildren : allChildren.filter((child) => keep.has(child));
    const expanded = options.expanded.has(id) || autoExpanded.has(id);
    rows.push({
      id,
      depth,
      hasChildren: children.length > 0,
      expanded: expanded && children.length > 0,
    });
    if (!expanded) {
      return;
    }
    for (const child of children) {
      if (path.has(child)) {
        // A cycle: the task is already on the path, it is not shown twice.
        continue;
      }
      path.add(child);
      visit(child, depth + 1);
      path.delete(child);
    }
  };

  for (const root of roots) {
    path.add(root);
    visit(root, 0);
    path.delete(root);
  }
  return rows;
}

/** Ids of the children of a task, sorted by id. */
export function childrenOf(tree: TaskTree, id: number): readonly number[] {
  return tree.children.get(id) ?? [];
}

/**
 * Drops the hidden rows of a flattened tree, with their whole subtree.
 *
 * The rows come in depth-first order: a hidden row hides every row that
 * follows it until the depth goes back to its own level or above.
 */
export function visibleTreeRows(
  rows: readonly TreeRow[],
  hidden: ReadonlySet<number>,
): TreeRow[] {
  if (hidden.size === 0) {
    return [...rows];
  }
  const visible: TreeRow[] = [];
  let hiddenDepth = -1;
  for (const row of rows) {
    if (hiddenDepth >= 0) {
      if (row.depth > hiddenDepth) {
        continue;
      }
      hiddenDepth = -1;
    }
    if (hidden.has(row.id)) {
      hiddenDepth = row.depth;
      continue;
    }
    visible.push(row);
  }
  return visible;
}

/**
 * A task and all its descendants, from the task down to the deepest ones.
 *
 * The traversal keeps the ids it has already visited, so a cycle can never
 * make it loop forever.
 */
export function subtreeOf(tree: TaskTree, id: number): number[] {
  if (!tree.parents.has(id)) {
    // The task is not part of the tree: it has no descendant.
    return [];
  }
  const result: number[] = [];
  const seen = new Set<number>();
  const stack: number[] = [id];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) {
      continue;
    }
    seen.add(current);
    result.push(current);
    for (const child of childrenOf(tree, current)) {
      stack.push(child);
    }
  }
  return result;
}

/** Id of the parent of a task, `null` for a root task. */
export function parentOf(tree: TaskTree, id: number): number | null {
  return tree.parents.get(id) ?? null;
}

/**
 * The chain of ancestors of a task, from the root of the forest down to the
 * parent of the task.
 */
export function ancestorsOf(tree: TaskTree, id: number): number[] {
  const chain: number[] = [];
  const seen = new Set<number>();
  let current = parentOf(tree, id);
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = parentOf(tree, current);
  }
  return chain.reverse();
}

/**
 * The tasks whose subtree holds at least one match, plus the matches.
 *
 * The ancestors of a match are found by walking up the parents, so the work is
 * proportional to the amount of matches and to the depth of the tree.
 */
function collectMatchingBranches(
  tree: TaskTree,
  matches: ReadonlySet<number>,
): Set<number> {
  const keep = new Set<number>();
  for (const match of matches) {
    if (!tree.parents.has(match)) {
      continue;
    }
    keep.add(match);
    for (const ancestor of ancestorsOf(tree, match)) {
      keep.add(ancestor);
    }
  }
  return keep;
}

/** The ancestors of the matches, without the matches themselves. */
function collectAncestorsOfMatches(
  tree: TaskTree,
  matches: ReadonlySet<number>,
): Set<number> {
  const ancestors = new Set<number>();
  for (const match of matches) {
    for (const ancestor of ancestorsOf(tree, match)) {
      ancestors.add(ancestor);
    }
  }
  return ancestors;
}

/** The tasks the displayed tree starts from. */
function resolveRoots(
  tree: TaskTree,
  focusId: number | null,
  keep: ReadonlySet<number> | null,
): number[] {
  if (focusId !== null) {
    if (!tree.parents.has(focusId)) {
      // The focused task does not exist (anymore): the general root is used.
      return keep === null ? [...tree.roots] : tree.roots.filter((id) => keep.has(id));
    }
    if (keep !== null && !keep.has(focusId)) {
      return [];
    }
    return [focusId];
  }
  return keep === null ? [...tree.roots] : tree.roots.filter((id) => keep.has(id));
}

/**
 * Detaches the tasks that close a cycle, so that every task has a parent
 * chain that ends on a root.
 */
function breakCycles(parents: Map<number, number | null>): void {
  const UNKNOWN = 0;
  const VISITING = 1;
  const DONE = 2;
  const state = new Map<number, number>();

  for (const start of parents.keys()) {
    if (state.get(start) === DONE) {
      continue;
    }
    const path: number[] = [];
    let current: number | null = start;
    while (current !== null) {
      const status = state.get(current) ?? UNKNOWN;
      if (status === DONE) {
        break;
      }
      if (status === VISITING) {
        // The task closes a cycle: it becomes a root.
        const index = path.indexOf(current);
        const closing = index >= 0 ? path[index] : undefined;
        if (closing !== undefined) {
          parents.set(closing, null);
        }
        break;
      }
      state.set(current, VISITING);
      path.push(current);
      current = parents.get(current) ?? null;
    }
    for (const id of path) {
      state.set(id, DONE);
    }
  }
}
