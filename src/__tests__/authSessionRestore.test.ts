import { describe, expect, it, vi } from 'vitest';
import {
  AUTHENTICATED_APP_SESSION_MARKER_KEY,
  clearAuthenticatedAppSession,
  hasAuthenticatedAppSession,
  LEGACY_CURRENT_USER_STORAGE_KEY,
  markAuthenticatedAppSession,
  purgeLegacySupabaseAuthStorage,
  restoreAuthenticatedUser,
} from '../services/authSessionRestore';
import { User } from '../types';

const profile: User = {
  id: '00000000-0000-4000-8000-000000000001',
  national_id: 'PROTECTED',
  name: 'Test User',
  vendor_id: null,
  induction_expiry: null,
  role: 'USER',
  created_at: '2026-08-09T00:00:00.000Z',
};

const createStorage = () => ({ removeItem: vi.fn() });

const createSessionStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
};

describe('auth session restoration', () => {
  it('purges the legacy PII cache and reloads the profile from a valid session', async () => {
    const events: string[] = [];
    const storage = {
      removeItem: vi.fn(() => events.push('cache-cleared')),
    };
    const getSession = vi.fn(async () => {
      events.push('session-read');
      return { access_token: 'session-token' };
    });
    const validateSession = vi.fn(async (accessToken: string) => {
      events.push('session-validated');
      expect(accessToken).toBe('session-token');
      return { requiresPinUpgrade: false };
    });
    const loadProfile = vi.fn(async () => profile);
    const signOut = vi.fn(async () => undefined);

    const result = await restoreAuthenticatedUser({
      storage,
      getSession,
      validateSession,
      loadProfile,
      signOut,
    });

    expect(result).toEqual(profile);
    expect(storage.removeItem).toHaveBeenCalledWith(LEGACY_CURRENT_USER_STORAGE_KEY);
    expect(events).toEqual(['cache-cleared', 'session-read', 'session-validated']);
    expect(loadProfile).toHaveBeenCalledOnce();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('does not restore a profile when the session requires a PIN upgrade', async () => {
    const storage = createStorage();
    const loadProfile = vi.fn(async () => profile);
    const signOut = vi.fn(async () => undefined);

    const result = await restoreAuthenticatedUser({
      storage,
      getSession: async () => ({ access_token: 'session-token' }),
      validateSession: async () => ({ requiresPinUpgrade: true }),
      loadProfile,
      signOut,
    });

    expect(result).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(LEGACY_CURRENT_USER_STORAGE_KEY);
    expect(loadProfile).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('clears legacy data even when no Supabase session remains', async () => {
    const storage = createStorage();
    const validateSession = vi.fn();
    const loadProfile = vi.fn();
    const signOut = vi.fn();

    const result = await restoreAuthenticatedUser({
      storage,
      getSession: async () => null,
      validateSession,
      loadProfile,
      signOut,
    });

    expect(result).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(LEGACY_CURRENT_USER_STORAGE_KEY);
    expect(validateSession).not.toHaveBeenCalled();
    expect(loadProfile).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('uses a PII-free session marker for a completed app login', () => {
    const storage = createSessionStorage();

    expect(hasAuthenticatedAppSession(storage)).toBe(false);
    markAuthenticatedAppSession(storage);
    expect(hasAuthenticatedAppSession(storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(AUTHENTICATED_APP_SESSION_MARKER_KEY, '1');

    clearAuthenticatedAppSession(storage);
    expect(hasAuthenticatedAppSession(storage)).toBe(false);
  });

  it('purges every legacy Supabase localStorage entry that can contain a user', () => {
    const storage = createStorage();

    purgeLegacySupabaseAuthStorage(storage, 'sb-example-auth-token');

    expect(storage.removeItem).toHaveBeenCalledWith('sb-example-auth-token');
    expect(storage.removeItem).toHaveBeenCalledWith('sb-example-auth-token-code-verifier');
    expect(storage.removeItem).toHaveBeenCalledWith('sb-example-auth-token-user');
  });
});
