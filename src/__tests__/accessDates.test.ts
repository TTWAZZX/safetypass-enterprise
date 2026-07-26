import { describe, expect, it } from 'vitest';
import { addOneYearIsoDate, getTodayIsoDate } from '../utils/accessDates';

describe('access date helpers', () => {
  it('sets the end date exactly one year after the start date', () => {
    expect(addOneYearIsoDate('2026-07-26')).toBe('2027-07-26');
  });

  it('keeps leap-day access inside February', () => {
    expect(addOneYearIsoDate('2024-02-29')).toBe('2025-02-28');
  });

  it('uses the local calendar date', () => {
    expect(getTodayIsoDate(new Date('2026-07-26T12:00:00.000Z'))).toMatch(/^2026-07-2[56]$/);
  });
});
