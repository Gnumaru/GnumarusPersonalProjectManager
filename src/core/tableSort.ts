/**
 * Sorting of the tables of the tasks and of the notes.
 *
 * A click on the name of a column sorts the table by it: the first click on a
 * column sorts it **descending**, and the next clicks on the same column
 * **invert** the direction (ascending becomes descending and the other way
 * round). Clicking another column makes it the new sort column, descending
 * again.
 *
 * The comparison is adapted to the kind of the column: **numeric** for the ids,
 * **alphabetic** for the names and the statuses, and **by date** for the
 * timestamps. The tags are never sortable.
 */

import { parseTaskTimestamp } from './task.js';

/** The direction of the sort of a column. */
export type SortDirection = 'asc' | 'desc';

/** How two values of a column are compared. */
export type SortType = 'number' | 'string' | 'date';

/** The state of the sort of one table. */
export interface SortState {
  /** The name of the column that sorts the table. */
  readonly field: string;
  readonly direction: SortDirection;
}

/**
 * The next state of the sort after a click on the name of a column.
 *
 * Another column becomes the sort column in the descending direction; the
 * column that already sorts the table only changes its direction.
 */
export function nextSortState(current: SortState | null, field: string): SortState {
  if (current === null || current.field !== field) {
    return { field, direction: 'desc' };
  }
  return current.direction === 'desc' ? { field, direction: 'asc' } : { field, direction: 'desc' };
}

/**
 * Sorts a copy of the rows by one column.
 *
 * `value` extracts the raw value of the column out of a row, and `type` chooses
 * the comparison: `number` compares numerically (a task without a parent sorts
 * before the ones that have one), `string` compares alphabetically, and `date`
 * parses the timestamps (`YYYYMMDDHHNNSSIII` or a legacy ISO stamp), so both
 * formats sort together. The input array is never modified.
 */
export function sortRows<T>(
  rows: readonly T[],
  state: SortState,
  value: (row: T) => number | string | null,
  type: SortType,
): T[] {
  const weight = (row: T): number | string | null => value(row);
  const sign = state.direction === 'asc' ? 1 : -1;
  const compare = (left: T, right: T): number => {
    const a = weight(left);
    const b = weight(right);
    // A task without a value always sorts before the ones with a value.
    if (a === null && b === null) {
      return 0;
    }
    if (a === null) {
      return -1;
    }
    if (b === null) {
      return 1;
    }
    let result: number;
    if (type === 'number') {
      result = Number(a) - Number(b);
    } else if (type === 'date') {
      const left = parseTaskTimestamp(String(a));
      const right = parseTaskTimestamp(String(b));
      result = (left?.getTime() ?? 0) - (right?.getTime() ?? 0);
    } else {
      result = compareStrings(String(a), String(b));
    }
    return result * sign;
  };
  // Array.prototype.sort is stable: the rows that tie keep their order.
  return [...rows].sort(compare);
}

/**
 * Compares two strings alphabetically, with the numbers inside them compared
 * numerically (`Task 9` before `Task 25`).
 *
 * The comparison is done by hand instead of through `localeCompare` because
 * its `numeric` option is not honoured by every implementation. The strings
 * are read one block at a time: two blocks of digits are compared as whole
 * numbers, the other characters by their code.
 */
function compareStrings(left: string, right: string): number {
  let indexL = 0;
  let indexR = 0;
  while (indexL < left.length && indexR < right.length) {
    const charL = left[indexL] ?? '';
    const charR = right[indexR] ?? '';
    if (isDigit(charL) && isDigit(charR)) {
      let endL = indexL;
      while (endL < left.length && isDigit(left[endL] ?? '')) {
        endL += 1;
      }
      let endR = indexR;
      while (endR < right.length && isDigit(right[endR] ?? '')) {
        endR += 1;
      }
      // Two blocks of digits without leading zeros: the longest is the larger.
      const digitsL = left.slice(indexL, endL);
      const digitsR = right.slice(indexR, endR);
      if (digitsL.length !== digitsR.length) {
        return digitsL.length - digitsR.length;
      }
      if (digitsL !== digitsR) {
        return digitsL < digitsR ? -1 : 1;
      }
      indexL = endL;
      indexR = endR;
      continue;
    }
    if (charL !== charR) {
      return charL < charR ? -1 : 1;
    }
    indexL += 1;
    indexR += 1;
  }
  return left.length - right.length;
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}
