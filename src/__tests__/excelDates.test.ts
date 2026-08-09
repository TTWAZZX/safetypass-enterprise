import { describe, expect, it } from 'vitest';
import { processExcelDate } from '../utils/excelDates';

const expectLocalCalendarDate = (value: string | null, year: number, month: number, day: number) => {
  expect(value).not.toBeNull();
  const date = new Date(value!);
  expect(date.getFullYear()).toBe(year);
  expect(date.getMonth() + 1).toBe(month);
  expect(date.getDate()).toBe(day);
  expect(date.getHours()).toBe(12);
};

describe('processExcelDate', () => {
  it('keeps YYYY-MM-DD text dates in year-month-day order', () => {
    expectLocalCalendarDate(processExcelDate('2026-03-15'), 2026, 3, 15);
  });

  it('accepts ISO-style slash and dot separators', () => {
    expectLocalCalendarDate(processExcelDate('2026/03/15'), 2026, 3, 15);
    expectLocalCalendarDate(processExcelDate('2026.03.15'), 2026, 3, 15);
  });

  it('supports DD/MM/YYYY and unambiguous MM/DD/YYYY text dates', () => {
    expectLocalCalendarDate(processExcelDate('15/03/2026'), 2026, 3, 15);
    expectLocalCalendarDate(processExcelDate('03/15/2026'), 2026, 3, 15);
  });

  it('uses DD/MM/YYYY for ambiguous localized text dates', () => {
    expectLocalCalendarDate(processExcelDate('03/04/2026'), 2026, 4, 3);
  });

  it('preserves Excel serial-number and Date cell values', () => {
    // 46096 is 2026-03-15 in Excel's 1900 date system.
    expectLocalCalendarDate(processExcelDate(46096), 2026, 3, 15);
    expectLocalCalendarDate(processExcelDate(46096.75), 2026, 3, 15);
    expectLocalCalendarDate(processExcelDate(new Date(2026, 2, 15, 9, 30)), 2026, 3, 15);
  });

  it('rejects invalid calendar dates instead of rolling them over', () => {
    expect(processExcelDate('2026-02-29')).toBeNull();
    expect(processExcelDate('31/04/2026')).toBeNull();
    expect(processExcelDate('not a date')).toBeNull();
  });
});
