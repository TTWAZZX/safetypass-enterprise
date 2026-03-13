/**
 * Unit tests for critical SafetyPass exam logic
 * Run: npm test
 * Requires: npm install -D vitest
 */

import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────
// 1. Expiry Date Calculations
// ─────────────────────────────────────────────

function calcInductionExpiry(from: Date): Date {
  const d = new Date(from);
  d.setFullYear(d.getFullYear() + 1);
  d.setHours(23, 59, 59, 999);
  return d;
}

function calcWorkPermitExpiry(from: Date): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + 4);
  d.setHours(23, 59, 59, 999);
  return d;
}

function isInductionValid(expiry: string | null): boolean {
  if (!expiry) return false;
  return new Date(expiry) > new Date();
}

describe('Expiry Date Calculation', () => {
  it('Induction expiry is exactly +1 year from today (end of day)', () => {
    const now = new Date('2026-03-13T10:00:00.000Z');
    const expiry = calcInductionExpiry(now);
    expect(expiry.getFullYear()).toBe(2027);
    expect(expiry.getMonth()).toBe(2);   // March (0-indexed)
    expect(expiry.getDate()).toBe(13);
    expect(expiry.getHours()).toBe(23);
    expect(expiry.getMinutes()).toBe(59);
    expect(expiry.getSeconds()).toBe(59);
  });

  it('Work Permit expiry is exactly +4 days from today (end of day)', () => {
    const now = new Date('2026-03-13T10:00:00.000Z');
    const expiry = calcWorkPermitExpiry(now);
    expect(expiry.getDate()).toBe(17);
    expect(expiry.getMonth()).toBe(2);   // March
    expect(expiry.getHours()).toBe(23);
    expect(expiry.getMinutes()).toBe(59);
  });

  it('Work Permit expiry rolls over month boundary correctly', () => {
    const now = new Date('2026-03-30T10:00:00.000Z');
    const expiry = calcWorkPermitExpiry(now);
    expect(expiry.getMonth()).toBe(3);  // April
    expect(expiry.getDate()).toBe(3);
  });

  it('Induction expiry rolls over year boundary correctly', () => {
    const now = new Date('2026-12-31T10:00:00.000Z');
    const expiry = calcInductionExpiry(now);
    expect(expiry.getFullYear()).toBe(2027);
    expect(expiry.getMonth()).toBe(11); // December
    expect(expiry.getDate()).toBe(31);
  });
});

// ─────────────────────────────────────────────
// 2. Induction Validity Check
// ─────────────────────────────────────────────

describe('Induction Validity', () => {
  it('null expiry → not valid', () => {
    expect(isInductionValid(null)).toBe(false);
  });

  it('past expiry → not valid', () => {
    expect(isInductionValid('2025-01-01T23:59:59.999Z')).toBe(false);
  });

  it('future expiry → valid', () => {
    expect(isInductionValid('2027-03-13T23:59:59.999Z')).toBe(true);
  });

  it('expired today (midnight) → not valid', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 59, 59, 999);
    expect(isInductionValid(yesterday.toISOString())).toBe(false);
  });
});

// ─────────────────────────────────────────────
// 3. Work Permit Number Validation
// ─────────────────────────────────────────────

function isValidPermitNo(permitNo: string): boolean {
  return /^\d{10}$/.test(permitNo);
}

describe('Work Permit Number Validation', () => {
  it('10-digit number → valid', () => {
    expect(isValidPermitNo('2026010012')).toBe(true);
  });

  it('9-digit number → invalid', () => {
    expect(isValidPermitNo('202601001')).toBe(false);
  });

  it('11-digit number → invalid', () => {
    expect(isValidPermitNo('20260100120')).toBe(false);
  });

  it('contains letters → invalid', () => {
    expect(isValidPermitNo('WP26010012')).toBe(false);
  });

  it('empty string → invalid', () => {
    expect(isValidPermitNo('')).toBe(false);
  });

  it('exactly 10 zeros → valid (edge case)', () => {
    expect(isValidPermitNo('0000000000')).toBe(true);
  });
});

// ─────────────────────────────────────────────
// 4. Score / Pass Threshold Calculation
// ─────────────────────────────────────────────

function calcPassedPercent(score: number, total: number): number {
  if (total === 0) return 0;
  return (score / total) * 100;
}

function isPassed(score: number, total: number, threshold: number): boolean {
  return calcPassedPercent(score, total) >= threshold;
}

describe('Exam Pass/Fail Calculation', () => {
  it('8/10 with 80% threshold → passed', () => {
    expect(isPassed(8, 10, 80)).toBe(true);
  });

  it('7/10 with 80% threshold → failed', () => {
    expect(isPassed(7, 10, 80)).toBe(false);
  });

  it('10/10 with any threshold → always passed', () => {
    expect(isPassed(10, 10, 100)).toBe(true);
  });

  it('0/10 → always failed', () => {
    expect(isPassed(0, 10, 80)).toBe(false);
  });

  it('0 questions → 0% (edge case, not passed)', () => {
    expect(isPassed(0, 0, 80)).toBe(false);
  });

  it('exactly at threshold (80/100 = 80%) → passed', () => {
    expect(isPassed(16, 20, 80)).toBe(true);
  });
});

// ─────────────────────────────────────────────
// 5. Rate Limit Check (client-side logic)
// ─────────────────────────────────────────────

function isRateLimited(lastSubmitTime: number, cooldownMs: number): boolean {
  return Date.now() - lastSubmitTime < cooldownMs;
}

describe('Client-side Rate Limiting', () => {
  it('no previous submit (time=0) → not limited', () => {
    expect(isRateLimited(0, 30_000)).toBe(false);
  });

  it('submitted 5 seconds ago → still limited (30s cooldown)', () => {
    const fiveSecondsAgo = Date.now() - 5_000;
    expect(isRateLimited(fiveSecondsAgo, 30_000)).toBe(true);
  });

  it('submitted 31 seconds ago → no longer limited', () => {
    const thirtyOneSecondsAgo = Date.now() - 31_000;
    expect(isRateLimited(thirtyOneSecondsAgo, 30_000)).toBe(false);
  });
});
