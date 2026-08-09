import { describe, expect, it } from 'vitest';
import { getExpiryLabel, getExpiryStatus } from '../services/expiryStatus';

const now = new Date('2026-08-09T00:00:00.000Z');

describe('expiry status presentation', () => {
  it('classifies missing and invalid dates without throwing', () => {
    expect(getExpiryStatus(null, now).state).toBe('NONE');
    expect(getExpiryStatus('not-a-date', now).state).toBe('NONE');
  });

  it('distinguishes normal, 30-day, seven-day and expired states', () => {
    expect(getExpiryStatus('2026-09-20T00:00:00.000Z', now).state).toBe('VALID');
    expect(getExpiryStatus('2026-08-29T00:00:00.000Z', now).state).toBe('EXPIRING');
    expect(getExpiryStatus('2026-08-14T00:00:00.000Z', now).state).toBe('URGENT');
    expect(getExpiryStatus('2026-08-08T00:00:00.000Z', now).state).toBe('EXPIRED');
  });

  it('creates concise Thai and English relative labels', () => {
    const status = getExpiryStatus('2026-08-14T00:00:00.000Z', now);
    expect(getExpiryLabel(status, 'th')).toBe('เหลือ 5 วัน');
    expect(getExpiryLabel(status, 'en')).toBe('5 days remaining');
  });
});

