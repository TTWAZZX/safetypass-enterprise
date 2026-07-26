import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import {
  MOTION_PREFERENCE_KEY,
  applyReducedMotionClass,
  parseStoredMotionPreference,
  resolveReducedMotion,
  StoredMotionPreference,
} from '../services/motionPreference';

interface MotionPreferenceContextValue {
  reduceMotion: boolean;
  systemPrefersReducedMotion: boolean;
  toggleReduceMotion: () => void;
}

const MotionPreferenceContext = createContext<MotionPreferenceContextValue | undefined>(undefined);

export const MotionPreferenceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [systemPrefersReducedMotion, setSystemPrefersReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [storedPreference, setStoredPreference] = useState<StoredMotionPreference>(
    () => parseStoredMotionPreference(window.localStorage.getItem(MOTION_PREFERENCE_KEY)),
  );
  const reduceMotion = resolveReducedMotion(storedPreference, systemPrefersReducedMotion);

  useEffect(() => {
    applyReducedMotionClass(reduceMotion);
  }, [reduceMotion]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const followSystemPreference = (event: MediaQueryListEvent) => setSystemPrefersReducedMotion(event.matches);
    mediaQuery.addEventListener('change', followSystemPreference);
    return () => mediaQuery.removeEventListener('change', followSystemPreference);
  }, []);

  const toggleReduceMotion = () => {
    if (systemPrefersReducedMotion) return;
    const next = reduceMotion ? 'full' : 'reduce';
    window.localStorage.setItem(MOTION_PREFERENCE_KEY, next);
    setStoredPreference(next);
  };

  return (
    <MotionPreferenceContext.Provider value={{ reduceMotion, systemPrefersReducedMotion, toggleReduceMotion }}>
      {children}
    </MotionPreferenceContext.Provider>
  );
};

export const useMotionPreference = () => {
  const context = useContext(MotionPreferenceContext);
  if (!context) throw new Error('useMotionPreference must be used within MotionPreferenceProvider');
  return context;
};
