export const MOTION_PREFERENCE_KEY = 'safety_pass_reduce_motion';

export type StoredMotionPreference = 'reduce' | 'full' | null;

export const parseStoredMotionPreference = (value: string | null): StoredMotionPreference => {
  if (value === 'reduce' || value === 'full') return value;
  return null;
};

export const resolveReducedMotion = (
  storedPreference: StoredMotionPreference,
  systemPrefersReducedMotion: boolean,
): boolean => systemPrefersReducedMotion || storedPreference === 'reduce';

export const getInitialReducedMotion = (): boolean => {
  if (typeof window === 'undefined') return false;
  const stored = parseStoredMotionPreference(window.localStorage.getItem(MOTION_PREFERENCE_KEY));
  return resolveReducedMotion(stored, window.matchMedia('(prefers-reduced-motion: reduce)').matches);
};

export const applyReducedMotionClass = (reduceMotion: boolean): void => {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('reduce-motion', reduceMotion);
};

export const initializeMotionPreference = (): boolean => {
  const reduceMotion = getInitialReducedMotion();
  applyReducedMotionClass(reduceMotion);
  return reduceMotion;
};
