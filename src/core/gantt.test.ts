import { describe, expect, it } from 'vite-plus/test';
import {
  addDays,
  barGeometry,
  barOf,
  buildLayout,
  buildSchedule,
  columnOfDay,
  DAY_WIDTH_PX,
  dayOfTimestamp,
  daysBetween,
  isoDate,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from './gantt.js';

describe('the date helpers', () => {
  it('keeps only the day of a date', () => {
    const date = new Date(2026, 9, 21, 23, 45, 29, 365);
    const day = startOfDay(date);

    expect(day.getFullYear()).toBe(2026);
    expect(day.getMonth()).toBe(9);
    expect(day.getDate()).toBe(21);
    expect(day.getHours()).toBe(0);
    expect(day.getMinutes()).toBe(0);
  });

  it('finds the Sunday of the week', () => {
    // The 21st of October 2026 is a Wednesday.
    expect(isoDate(startOfWeek(new Date(2026, 9, 21)))).toBe('2026-10-18');
    // A Sunday is its own week.
    expect(isoDate(startOfWeek(new Date(2026, 9, 25)))).toBe('2026-10-25');
    // A Monday belongs to the week that starts on the Sunday before.
    expect(isoDate(startOfWeek(new Date(2026, 9, 19)))).toBe('2026-10-18');
    // A Saturday too.
    expect(isoDate(startOfWeek(new Date(2026, 9, 24)))).toBe('2026-10-18');
  });

  it('finds the first day of the month', () => {
    expect(isoDate(startOfMonth(new Date(2026, 9, 21)))).toBe('2026-10-01');
  });

  it('counts the days between two dates', () => {
    expect(daysBetween(new Date(2026, 9, 1), new Date(2026, 9, 11))).toBe(10);
    expect(daysBetween(new Date(2026, 9, 11), new Date(2026, 9, 1))).toBe(-10);
  });

  it('shifts a date by a number of days', () => {
    expect(isoDate(addDays(new Date(2026, 9, 31), 1))).toBe('2026-11-01');
    expect(isoDate(addDays(new Date(2026, 0, 1), -1))).toBe('2025-12-31');
  });

  it('reads the day of a compact timestamp', () => {
    expect(dayOfTimestamp('20261021024529365')).not.toBeNull();
    expect(isoDate(dayOfTimestamp('20261021024529365') as Date)).toBe('2026-10-21');
    expect(dayOfTimestamp('')).toBeNull();
  });
});

describe('buildSchedule', () => {
  it('widens the range to whole weeks', () => {
    const schedule = buildSchedule(new Date(2026, 9, 21), new Date(2026, 9, 30));

    // The week starts on Sunday and ends on Saturday.
    expect(isoDate(schedule.start)).toBe('2026-10-18');
    expect(isoDate(schedule.end)).toBe('2026-10-31');
    expect(schedule.days).toHaveLength(14);
  });

  it('numbers the weeks from the first day of the year and the months from the calendar', () => {
    const schedule = buildSchedule(new Date(2026, 9, 21), new Date(2026, 11, 10));

    // The weeks are counted from the week that holds the first of January.
    expect(schedule.weeks[0]?.number).toBe(43);
    expect(schedule.weeks[1]?.number).toBe(44);

    // The months keep the number of the month of the year.
    expect(schedule.months[0]?.number).toBe(10);
    expect(schedule.months[0]?.name).toBe('October');
    expect(schedule.months[1]?.number).toBe(11);
    expect(schedule.months[1]?.name).toBe('November');

    expect(schedule.days[0]?.week).toBe(43);
    expect(schedule.days[0]?.month).toBe(10);
  });

  it('shares the first week of a year with the last week of the year before', () => {
    // The week that holds the first of January 2027 starts on the 27th of
    // December 2026: it is the first week of 2027.
    const schedule = buildSchedule(new Date(2026, 11, 20), new Date(2027, 0, 20));
    const numbers = schedule.weeks.map((week) => week.number);

    expect(numbers[0]).toBe(52);
    expect(numbers[1]).toBe(1);
    expect(numbers[2]).toBe(2);
  });

  it('shares the last week of a year with the first week of the next year', () => {
    // The week that holds the 31st of December 2026 ends on the 2nd of January
    // 2027: it is the first week of 2027.
    const schedule = buildSchedule(new Date(2026, 10, 20), new Date(2027, 0, 20));
    const numbers = schedule.weeks.map((week) => week.number);

    expect(numbers).toContain(52);
    expect(numbers).toContain(1);
  });

  it('marks the weekends', () => {
    const schedule = buildSchedule(new Date(2026, 9, 19), new Date(2026, 9, 25));
    const weekends = schedule.days.filter((day) => day.weekend);

    // The schedule covers two whole weeks: two Sundays and two Saturdays.
    expect(weekends).toHaveLength(4);
    expect(isoDate(weekends[0]?.date ?? new Date())).toBe('2026-10-18');
    expect(isoDate(weekends[1]?.date ?? new Date())).toBe('2026-10-24');
  });
});

describe('buildLayout', () => {
  const schedule = buildSchedule(new Date(2026, 9, 21), new Date(2026, 10, 20));

  it('draws one column per day', () => {
    const layout = buildLayout(schedule, new Set<string>());

    expect(layout.columns).toHaveLength(schedule.days.length);
    expect(layout.columns.every((column) => column.kind === 'day')).toBe(true);
    expect(layout.columns[0]?.width).toBe(DAY_WIDTH_PX);
  });

  it('numbers and names the months and the weeks', () => {
    const layout = buildLayout(schedule, new Set<string>());

    expect(layout.months.map((cell) => cell.number)).toEqual([10, 11]);
    expect(layout.months[0]?.label).toBe('October');
    expect(layout.months[1]?.label).toBe('November');
    expect(layout.weeks[0]?.number).toBe(43);
    expect(layout.weeks[0]?.label).toContain('Oct');
  });

  it('cuts the months where the days say so, not where the weeks end', () => {
    // The week of the 30th of August 2026 ends on the 5th of September: the
    // month of September starts on the 1st, in the middle of the week.
    const across = buildSchedule(new Date(2026, 7, 25), new Date(2026, 8, 6));
    const layout = buildLayout(across, new Set<string>());

    expect(layout.months.map((cell) => cell.number)).toEqual([8, 9]);
    // The schedule covers the 23rd of August to the 12th of September: the
    // month of August holds the 9 first days, the one of September the 12
    // others. The month of September does not wait for the end of the week.
    expect(layout.months[0]?.width).toBe(9 * DAY_WIDTH_PX);
    expect(layout.months[1]?.width).toBe(12 * DAY_WIDTH_PX);
  });

  it('hides the days of a collapsed week', () => {
    const week = schedule.weeks[1];
    expect(week).toBeDefined();
    if (week === undefined) {
      return;
    }
    const layout = buildLayout(schedule, new Set([week.key]));

    const collapsed = layout.columns.filter((column) => column.kind === 'week');
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.days).toBe(7);
    // The days of the collapsed week are not drawn any more.
    expect(layout.columns).toHaveLength(schedule.days.length - 6);
  });

  it('does not collapse the months any more', () => {
    const month = schedule.months[0];
    expect(month).toBeDefined();
    if (month === undefined) {
      return;
    }
    const layout = buildLayout(schedule, new Set([month.key]));

    // The months follow the days: nothing changes when a month is "collapsed".
    expect(layout.columns.filter((column) => column.kind === 'month')).toHaveLength(0);
    expect(layout.columns).toHaveLength(schedule.days.length);
  });

  it('keeps the width of the headers and of the columns in sync', () => {
    const layout = buildLayout(schedule, new Set<string>());

    const total = layout.columns.reduce((sum, column) => sum + column.width, 0);
    const months = layout.months.reduce((sum, cell) => sum + cell.width, 0);
    const weeks = layout.weeks.reduce((sum, cell) => sum + cell.width, 0);

    expect(months).toBe(total);
    expect(weeks).toBe(total);
  });
});

describe('the bars of the tasks', () => {
  const schedule = buildSchedule(new Date(2026, 9, 21), new Date(2026, 9, 30));
  const layout = buildLayout(schedule, new Set<string>());

  it('finds the column of a day', () => {
    // The 21st of October is the third day of the schedule.
    expect(columnOfDay(layout.columns, 2)).toBe(2);
    expect(columnOfDay(layout.columns, 0)).toBe(0);
  });

  it('draws the bar from the start day to the end day', () => {
    const bar = barOf(layout.columns, 2, 5);

    expect(bar?.first).toBe(2);
    expect(bar?.last).toBe(5);
  });

  it('draws no bar when the task has no date', () => {
    expect(barOf(layout.columns, null, null)).toBeNull();
  });

  it('draws the bar of a task without an end date until the end of the schedule', () => {
    const bar = barOf(layout.columns, 2, null);

    expect(bar?.first).toBe(2);
    expect(bar?.last).toBe(layout.columns.length - 1);
  });

  it('places the bar where it belongs', () => {
    const bar = barOf(layout.columns, 2, 5);
    expect(bar).not.toBeNull();
    if (bar === null) {
      return;
    }
    const geometry = barGeometry(layout.columns, bar);

    expect(geometry.left).toBe(2 * DAY_WIDTH_PX);
    expect(geometry.width).toBe(4 * DAY_WIDTH_PX);
  });

  it('draws the bar of a task that starts after it ends', () => {
    const bar = barOf(layout.columns, 5, 2);

    expect(bar?.first).toBe(2);
    expect(bar?.last).toBe(5);
  });
});
