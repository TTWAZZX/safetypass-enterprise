import { describe, expect, it } from 'vitest';
import { parseStoredMotionPreference, resolveReducedMotion } from '../services/motionPreference';

describe('motion preference', () => {
  it('accepts only supported stored values', () => {
    expect(parseStoredMotionPreference('reduce')).toBe('reduce');
    expect(parseStoredMotionPreference('full')).toBe('full');
    expect(parseStoredMotionPreference('invalid')).toBeNull();
    expect(parseStoredMotionPreference(null)).toBeNull();
  });

  it('follows the operating system until the user chooses explicitly', () => {
    expect(resolveReducedMotion(null, true)).toBe(true);
    expect(resolveReducedMotion(null, false)).toBe(false);
    expect(resolveReducedMotion('reduce', false)).toBe(true);
    expect(resolveReducedMotion('full', true)).toBe(true);
  });
});
