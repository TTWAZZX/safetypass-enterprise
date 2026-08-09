import { describe, expect, it } from 'vitest';
import { getPinConfirmationState } from '../services/pinUx';

describe('getPinConfirmationState', () => {
  it('does not report an error before confirmation starts', () => {
    expect(getPinConfirmationState('123456', '')).toBe('EMPTY');
  });

  it('waits for both PIN values to contain six digits', () => {
    expect(getPinConfirmationState('123456', '123')).toBe('INCOMPLETE');
    expect(getPinConfirmationState('12345', '123456')).toBe('INCOMPLETE');
  });

  it('reports matching and mismatching confirmations', () => {
    expect(getPinConfirmationState('654321', '654321')).toBe('MATCH');
    expect(getPinConfirmationState('654321', '654320')).toBe('MISMATCH');
  });
});
