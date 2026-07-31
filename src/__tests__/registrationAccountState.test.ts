import { describe, expect, it } from 'vitest';
import { resolveRegistrationStatus } from '../services/registrationAccountState';

describe('registration account-state contract', () => {
  it('treats an empty public lookup as a new registration', () => {
    expect(resolveRegistrationStatus(null).state).toBe('NOT_FOUND');
    expect(resolveRegistrationStatus({ user_exists: false }).state).toBe('NOT_FOUND');
  });

  it('distinguishes a staged profile from a completed account', () => {
    expect(resolveRegistrationStatus({
      user_exists: true,
      requires_registration: true,
      is_active: true,
    }).state).toBe('STAGED');

    expect(resolveRegistrationStatus({
      user_exists: true,
      requires_registration: false,
      is_active: true,
    }).state).toBe('REGISTERED');
  });

  it('gives suspension priority over registration progress', () => {
    expect(resolveRegistrationStatus({
      user_exists: true,
      requires_registration: true,
      is_active: false,
    }).state).toBe('SUSPENDED');
  });
});
