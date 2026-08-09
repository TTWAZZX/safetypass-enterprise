import type { User } from '../types';

export const LEGACY_CURRENT_USER_STORAGE_KEY = 'safety_pass_current_user';
export const AUTHENTICATED_APP_SESSION_MARKER_KEY = 'safety_pass_authenticated_session';
const AUTHENTICATED_APP_SESSION_MARKER_VALUE = '1';

type SessionForRestore = {
  access_token: string;
} | null;

type SessionStatus = {
  requiresPinUpgrade?: boolean;
} | null;

type StorageForRestore = Pick<Storage, 'removeItem'>;
type SessionMarkerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * This marker contains no user data. It distinguishes a completed login from
 * the temporary Supabase session used while a staged account is registering.
 */
export const hasAuthenticatedAppSession = (storage: SessionMarkerStorage): boolean => (
  storage.getItem(AUTHENTICATED_APP_SESSION_MARKER_KEY)
    === AUTHENTICATED_APP_SESSION_MARKER_VALUE
);

export const markAuthenticatedAppSession = (storage: SessionMarkerStorage): void => {
  storage.setItem(
    AUTHENTICATED_APP_SESSION_MARKER_KEY,
    AUTHENTICATED_APP_SESSION_MARKER_VALUE,
  );
};

export const clearAuthenticatedAppSession = (storage: SessionMarkerStorage): void => {
  storage.removeItem(AUTHENTICATED_APP_SESSION_MARKER_KEY);
};

/** Removes the old Supabase localStorage entries that may contain user.email. */
export const purgeLegacySupabaseAuthStorage = (
  storage: StorageForRestore,
  legacyStorageKey: string,
): void => {
  storage.removeItem(legacyStorageKey);
  storage.removeItem(`${legacyStorageKey}-code-verifier`);
  storage.removeItem(`${legacyStorageKey}-user`);
};

interface RestoreAuthenticatedUserOptions {
  storage: StorageForRestore;
  getSession: () => Promise<SessionForRestore>;
  validateSession: (accessToken: string) => Promise<SessionStatus>;
  loadProfile: () => Promise<User>;
  signOut: () => Promise<unknown>;
}

/**
 * Restores only a validated Supabase session. The legacy app-managed user
 * cache is removed before restoring, so profile PII is kept in memory only.
 */
export const restoreAuthenticatedUser = async ({
  storage,
  getSession,
  validateSession,
  loadProfile,
  signOut,
}: RestoreAuthenticatedUserOptions): Promise<User | null> => {
  storage.removeItem(LEGACY_CURRENT_USER_STORAGE_KEY);

  const session = await getSession();
  if (!session) return null;

  const status = await validateSession(session.access_token);
  if (status?.requiresPinUpgrade !== false) {
    await signOut();
    return null;
  }

  return loadProfile();
};
