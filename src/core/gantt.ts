/**
 * The schedule of the Gantt chart.
 *
 * The chart has one column per day. The days are grouped by week and the
 * weeks by month: the weeks and the months are **numbered and named**,
 * counting from one.
 *
 * A week (or a month) can be collapsed: its days are not drawn any more and
 * the whole period becomes a single column.
 *
 * The module is pure: it knows nothing about the files nor about the service.
 */

import { parseTaskTimestamp } from './task.js';

/** The width of a day column, in pixels. */
export const DAY_WIDTH_PX = 28;
/** The width of a collapsed week, in pixels. */
export const COLLAPSED_WEEK_WIDTH_PX = 56;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const MONTH_SHORT_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

/** The given date, at midnight. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * The Sunday of the week of the given date.
 *
 * The week of the chart starts on Sunday and ends on Saturday.
 */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  return addDays(day, -day.getDay());
}

/** The first day of the month of the given date. */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** The date, shifted by a number of days. */
export function addDays(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

/** The number of days between two dates (`to - from`). */
export function daysBetween(from: Date, to: Date): number {
  const start = startOfDay(from).getTime();
  const end = startOfDay(to).getTime();
  return Math.round((end - start) / 86_400_000);
}

/** The date in the `YYYY-MM-DD` format: the key of a day, a week or a month. */
export function isoDate(date: Date): string {
  const pad = (value: number, length = 2): string => String(value).padStart(length, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The day of a compact timestamp, `null` when the timestamp is empty. */
export function dayOfTimestamp(value: string): Date | null {
  const date = parseTaskTimestamp(value);
  return date === null ? null : startOfDay(date);
}

/**
 * The number of the week of a year, counting from the first day of the year.
 *
 * The first week of a year is the week that holds its first of January: it
 * shares its days with the last week of the year before when the first of
 * January is not a Sunday. The last week of a year is the week that holds its
 * 31st of December: it shares its days with the first week of the next year
 * when the 31st of December is not a Saturday.
 */
export function weekNumberOf(week: Date): number {
  if (holdsFirstOfJanuary(week)) {
    // The week that holds the first of January is the first week of the year.
    return 1;
  }
  const year = week.getFullYear();
  const firstWeek = startOfWeek(new Date(year, 0, 1));
  return Math.round(daysBetween(firstWeek, week) / 7) + 1;
}

/** True when the week holds the first of January of a year. */
function holdsFirstOfJanuary(week: Date): boolean {
  const key = isoDate(week);
  const year = week.getFullYear();
  return (
    isoDate(startOfWeek(new Date(year, 0, 1))) === key ||
    isoDate(startOfWeek(new Date(year + 1, 0, 1))) === key
  );
}

/** One day of the schedule. */
export interface GanttDay {
  /** The day, at midnight. */
  readonly date: Date;
  /** The index of the day since the beginning of the schedule. */
  readonly index: number;
  /** The day of the month. */
  readonly dayOfMonth: number;
  /** The number of the week, counting from one. */
  readonly week: number;
  /** The number of the month, counting from one. */
  readonly month: number;
  /** `true` for Saturday and Sunday. */
  readonly weekend: boolean;
}

/** One week of the schedule. */
export interface GanttWeek {
  /**
   * The number of the week, counting from the first day of the year.
   *
   * The first week of a year is the week that holds its first of January: it
   * is shared with the last week of the year before when the first of January
   * is not a Sunday. The last week of a year is the week that holds its 31st
   * of December: it is shared with the first week of the next year when the
   * 31st of December is not a Saturday.
   */
  readonly number: number;
  /** The first day of the week. */
  readonly firstDay: Date;
  /** The index of the first day of the week in the schedule. */
  readonly firstDayIndex: number;
  /** The number of days of the week that are in the schedule. */
  readonly days: number;
  /** The key of the week: the ISO date of its first day. */
  readonly key: string;
}

/** One month of the schedule. */
export interface GanttMonth {
  /** The number of the month of the year, from 1 (January) to 12 (December). */
  readonly number: number;
  /** The name of the month. */
  readonly name: string;
  /** The year of the month. */
  readonly year: number;
  /** The first day of the month. */
  readonly firstDay: Date;
  /** The index of the first day of the month in the schedule. */
  readonly firstDayIndex: number;
  /** The number of days of the month that are in the schedule. */
  readonly days: number;
  /** The key of the month: the ISO date of its first day. */
  readonly key: string;
}

/** The days, the weeks and the months of the schedule. */
export interface GanttSchedule {
  /** The first day of the schedule: the Sunday of the first week. */
  readonly start: Date;
  /** The last day of the schedule: the Saturday of the last week. */
  readonly end: Date;
  readonly days: readonly GanttDay[];
  readonly weeks: readonly GanttWeek[];
  readonly months: readonly GanttMonth[];
}

/** A week, while the schedule is being built. */
interface MutableWeek {
  number: number;
  firstDay: Date;
  firstDayIndex: number;
  days: number;
  key: string;
}

/** A month, while the schedule is being built. */
interface MutableMonth {
  number: number;
  name: string;
  year: number;
  firstDay: Date;
  firstDayIndex: number;
  days: number;
  key: string;
}

/**
 * Builds the schedule of a range of dates.
 *
 * The range is widened to whole weeks, so every week of the schedule is
 * complete.
 */
export function buildSchedule(from: Date, to: Date): GanttSchedule {
  const start = startOfWeek(from);
  const end = addDays(startOfWeek(to), 6);

  const days: GanttDay[] = [];
  const mutableWeeks: MutableWeek[] = [];
  const mutableMonths: MutableMonth[] = [];

  let cursor = start;
  let index = 0;
  while (cursor.getTime() <= end.getTime()) {
    const monthKey = isoDate(startOfMonth(cursor));

    let month = mutableMonths[mutableMonths.length - 1];
    if (month === undefined || month.key !== monthKey) {
      month = {
        number: cursor.getMonth() + 1,
        name: MONTH_NAMES[cursor.getMonth()] ?? '',
        year: cursor.getFullYear(),
        firstDay: startOfMonth(cursor),
        firstDayIndex: index,
        days: 0,
        key: monthKey,
      };
      mutableMonths.push(month);
    }
    month.days += 1;

    const weekKey = isoDate(startOfWeek(cursor));
    let week = mutableWeeks[mutableWeeks.length - 1];
    if (week === undefined || week.key !== weekKey) {
      week = {
        number: weekNumberOf(cursor),
        firstDay: cursor,
        firstDayIndex: index,
        days: 0,
        key: weekKey,
      };
      mutableWeeks.push(week);
    }
    week.days += 1;

    const weekday = cursor.getDay();
    days.push({
      date: cursor,
      index,
      dayOfMonth: cursor.getDate(),
      week: week.number,
      month: month.number,
      weekend: weekday === 0 || weekday === 6,
    });

    cursor = addDays(cursor, 1);
    index += 1;
  }

  const weeks: GanttWeek[] = mutableWeeks.map((week) => ({ ...week }));
  const months: GanttMonth[] = mutableMonths.map((month) => ({ ...month }));

  return { start, end, days, weeks, months };
}

/** The kind of a column of the chart. */
export type GanttColumnKind = 'day' | 'week' | 'month';

/** One column of the chart. */
export interface GanttColumn {
  readonly kind: GanttColumnKind;
  /** The key of the column: the ISO date of its first day. */
  readonly key: string;
  /** The index of the first day of the column in the schedule. */
  readonly firstDayIndex: number;
  /** The number of days the column covers. */
  readonly days: number;
  /** The width of the column, in pixels. */
  readonly width: number;
  /** The label of the header of the column. */
  readonly label: string;
  /** The tooltip of the header of the column. */
  readonly title: string;
  /** `true` for a weekend day. */
  readonly weekend: boolean;
  /** `true` for the columns that carry the second colour of the stripes. */
  readonly alternate: boolean;
}

/** A cell of the header of the chart (a month or a week). */
export interface GanttHeaderCell {
  /** The key of the cell: the ISO date of the first day of the period. */
  readonly key: string;
  /** The number of the period: the month of the year or the week of the year. */
  readonly number: number;
  /** The name of the period. */
  readonly label: string;
  /** The tooltip of the cell. */
  readonly title: string;
  /** The width of the cell, in pixels. */
  readonly width: number;
  /** `true` when the period is collapsed. */
  readonly collapsed: boolean;
}

/** The columns and the headers of the chart. */
export interface GanttLayout {
  readonly columns: readonly GanttColumn[];
  readonly months: readonly GanttHeaderCell[];
  readonly weeks: readonly GanttHeaderCell[];
}

/** A cell of the header, while the layout is being built. */
interface MutableHeaderCell {
  key: string;
  number: number;
  label: string;
  title: string;
  width: number;
  collapsed: boolean;
}

/**
 * Builds the columns of the chart and its headers.
 *
 * The **months follow the days**: a month ends exactly where the next one
 * begins, even when a week crosses the boundary of two months. Only the weeks
 * can be collapsed: a collapsed week becomes a single narrow column and its
 * days are not drawn any more.
 */
export function buildLayout(
  schedule: GanttSchedule,
  collapsed: ReadonlySet<string>,
): GanttLayout {
  const columns: GanttColumn[] = [];
  const mutableMonths: MutableHeaderCell[] = [];
  const weeks: GanttHeaderCell[] = [];

  for (const week of schedule.weeks) {
    const isWeekCollapsed = collapsed.has(week.key);
    const weekColumns: GanttColumn[] = [];

    if (isWeekCollapsed) {
      weekColumns.push({
        kind: 'week',
        key: week.key,
        firstDayIndex: week.firstDayIndex,
        days: week.days,
        width: COLLAPSED_WEEK_WIDTH_PX,
        label: String(week.number),
        title: weekTitle(week),
        weekend: false,
        alternate: false,
      });
    } else {
      for (let index = week.firstDayIndex; index < week.firstDayIndex + week.days; index += 1) {
        const day = schedule.days[index];
        if (day === undefined) {
          continue;
        }
        weekColumns.push({
          kind: 'day',
          key: isoDate(day.date),
          firstDayIndex: day.index,
          days: 1,
          width: DAY_WIDTH_PX,
          label: String(day.dayOfMonth),
          title: dayTitle(day),
          weekend: day.weekend,
          alternate: day.index % 2 === 1,
        });
      }
    }

    weeks.push({
      key: week.key,
      number: week.number,
      label: shortDate(week.firstDay),
      title: weekTitle(week),
      width: sumWidth(weekColumns),
      collapsed: isWeekCollapsed,
    });

    // The months are cut where the days say so, not where the weeks end.
    for (const column of weekColumns) {
      const date = dayOfIndex(schedule, column.firstDayIndex);
      const key = isoDate(startOfMonth(date));
      let month = mutableMonths[mutableMonths.length - 1];
      if (month === undefined || month.key !== key) {
        month = {
          key,
          number: date.getMonth() + 1,
          label: MONTH_NAMES[date.getMonth()] ?? '',
          title: `${MONTH_NAMES[date.getMonth()] ?? ''} ${date.getFullYear()}`,
          width: 0,
          collapsed: false,
        };
        mutableMonths.push(month);
      }
      month.width += column.width;
    }

    columns.push(...weekColumns);
  }

  return { columns, months: mutableMonths, weeks };
}

/** The bar of a task, in column indexes. */
export interface GanttBar {
  /** The index of the first column of the bar. */
  readonly first: number;
  /** The index of the last column of the bar. */
  readonly last: number;
}

/**
 * The columns covered by the bar of a task.
 *
 * `null` when the task has no date at all. A task without an end date goes
 * until the end of the schedule, a task without a start date begins with it.
 */
export function barOf(
  columns: readonly GanttColumn[],
  startDay: number | null,
  endDay: number | null,
): GanttBar | null {
  if (columns.length === 0) {
    return null;
  }
  if (startDay === null && endDay === null) {
    return null;
  }
  const first = startDay === null ? 0 : columnOfDay(columns, startDay);
  const last = endDay === null ? columns.length - 1 : columnOfDay(columns, endDay);
  if (first === null || last === null) {
    return null;
  }
  return { first: Math.min(first, last), last: Math.max(first, last) };
}

/** The index of the column that holds a day of the schedule. */
export function columnOfDay(columns: readonly GanttColumn[], dayIndex: number): number | null {
  for (let index = columns.length - 1; index >= 0; index -= 1) {
    const column = columns[index];
    if (column !== undefined && dayIndex >= column.firstDayIndex) {
      return index;
    }
  }
  return null;
}

/** The day of the schedule at an index, at midnight. */
export function dayOfIndex(schedule: GanttSchedule, index: number): Date {
  return addDays(schedule.start, index);
}

/** The left offset and the width of a bar, in pixels. */
export function barGeometry(
  columns: readonly GanttColumn[],
  bar: GanttBar,
): { readonly left: number; readonly width: number } {
  let left = 0;
  for (let index = 0; index < bar.first; index += 1) {
    left += columns[index]?.width ?? 0;
  }
  let width = 0;
  for (let index = bar.first; index <= bar.last; index += 1) {
    width += columns[index]?.width ?? 0;
  }
  return { left, width };
}

function sumWidth(columns: readonly GanttColumn[]): number {
  let total = 0;
  for (const column of columns) {
    total += column.width;
  }
  return total;
}

function shortDate(date: Date): string {
  return `${MONTH_SHORT_NAMES[date.getMonth()] ?? ''} ${date.getDate()}`;
}

function dayTitle(day: GanttDay): string {
  const name = WEEKDAY_NAMES[day.date.getDay()] ?? '';
  return `${name} ${day.dayOfMonth} ${MONTH_NAMES[day.date.getMonth()] ?? ''} ${day.date.getFullYear()}`;
}

function weekTitle(week: GanttWeek): string {
  const last = addDays(week.firstDay, week.days - 1);
  return `Week ${week.number}: ${shortDate(week.firstDay)} – ${shortDate(last)} ${last.getFullYear()}`;
}

/** The letter of the weekday, for the header of a day. */
export function weekdayInitial(date: Date): string {
  return WEEKDAY_INITIALS[date.getDay()] ?? '';
}
