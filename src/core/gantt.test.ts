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

  it('finds the Monday of the week', () => {
    // The 21st of October 2026 is a Wednesday.
    expect(isoDate(startOfWeek(new Date(2026, 9, 21)))).toBe('2026-10-19');
    // A Sunday belongs to the week that starts on the Monday before.
    expect(isoDate(startOfWeek(new Date(2026, 9, 25)))).toBe('2026-10-19');
    // A Monday is its own week.
    expect(isoDate(startOfWeek(new Date(2026, 9, 19)))).toBe('2026-10-19');
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

    expect(isoDate(schedule.start)).toBe('2026-10-19');
    expect(isoDate(schedule.end)).toBe('2026-11-01');
    expect(schedule.days).toHaveLength(14);
  });

  it('numbers the weeks and the months from one', () => {
    const schedule = buildSchedule(new Date(2026, 9, 21), new Date(2026, 11, 10));

    expect(schedule.weeks[0]?.number).toBe(1);
    expect(schedule.weeks[1]?.number).toBe(2);
    expect(schedule.months[0]?.number).toBe(1);
    expect(schedule.months[0]?.name).toBe('October');
    expect(schedule.months[1]?.number).toBe(2);
    expect(schedule.months[1]?.name).toBe('November');
    expect(schedule.days[0]?.week).toBe(1);
    expect(schedule.days[0]?.month).toBe(1);
  });

  it('marks the weekends', () => {
    const schedule = buildSchedule(new Date(2026, 9, 19), new Date(2026, 9, 25));
    const weekends = schedule.days.filter((day) => day.weekend);

    expect(weekends).toHaveLength(2);
    expect(isoDate(weekends[0]?.date ?? new Date())).toBe('2026-10-24');
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

    expect(layout.months.map((cell) => cell.number)).toEqual([1, 2]);
    expect(layout.months[0]?.label).toBe('October');
    expect(layout.months[1]?.label).toBe('November');
    expect(layout.weeks[0]?.number).toBe(1);
    expect(layout.weeks[0]?.label).toContain('Oct');
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

  it('hides the weeks and the days of a collapsed month', () => {
    const month = schedule.months[0];
    expect(month).toBeDefined();
    if (month === undefined) {
      return;
    }
    const layout = buildLayout(schedule, new Set([month.key]));

    const collapsed = layout.columns.filter((column) => column.kind === 'month');
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.days).toBe(month.days);
    // The weeks of the collapsed month are not drawn any more.
    expect(layout.weeks.every((cell) => cell.number > 2)).toBe(true);
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
