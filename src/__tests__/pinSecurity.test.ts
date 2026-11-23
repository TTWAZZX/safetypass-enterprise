import { describe, expect, it } from 'vitest';
import {
  createLegacyPinPassword, getSecurePinError, LEGACY_PIN_LENGTH, SECURE_PIN_LENGTH,
} from '../services/pinSecurity';

describe('PIN security compatibility', () => {
  const nationalId = '1234567890123';

  it('keeps the legacy credential format unchanged', () => {
    expect(LEGACY_PIN_LENGTH).toBe(4);
    expect(createLegacyPinPassword(nationalId, '0123')).toBe('SafetyPass-1234567890123-0123');
  });

  it('accepts a private six-digit PIN', () => {
    expect(SECURE_PIN_LENGTH).toBe(6);
    expect(getSecurePinError(nationalId, '246801')).toBeNull();
  });

  it.each(['654321', '111111', '121212', '000000', '123456'])('accepts six-digit PIN %s', (pin) => {
    expect(getSecurePinError(nationalId, pin)).toBeNull();
  });

  it('rejects reusing the last six digits of the national ID', () => {
    expect(getSecurePinError(nationalId, '890123')).toContain('PIN');
  });

  it.each(['12345', '1234567', 'abcdef'])('rejects malformed PIN %s', (pin) => {
    expect(getSecurePinError(nationalId, pin)).toContain('PIN');
  });
});
