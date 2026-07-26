import React from 'react';
import { Accessibility } from 'lucide-react';
import { useTranslation } from '../context/LanguageContext';
import { useMotionPreference } from '../context/MotionPreferenceContext';

const MotionPreferenceToggle: React.FC = () => {
  const { language } = useTranslation();
  const { reduceMotion, systemPrefersReducedMotion, toggleReduceMotion } = useMotionPreference();
  const label = systemPrefersReducedMotion
    ? (language === 'th' ? 'ลดการเคลื่อนไหวตามการตั้งค่าอุปกรณ์' : 'Reduced motion is controlled by your device')
    : language === 'th'
      ? (reduceMotion ? 'เปิดการเคลื่อนไหวตามปกติ' : 'ลดการเคลื่อนไหว')
      : (reduceMotion ? 'Enable full motion' : 'Reduce motion');

  return (
    <button
      type="button"
      onClick={toggleReduceMotion}
      disabled={systemPrefersReducedMotion}
      aria-label={label}
      aria-pressed={reduceMotion}
      title={label}
      className={`flex min-h-11 min-w-11 items-center justify-center rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed ${reduceMotion ? 'border-blue-400/50 bg-blue-500/20 text-blue-300' : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:text-white'}`}
    >
      <Accessibility size={18} aria-hidden="true" />
    </button>
  );
};

export default MotionPreferenceToggle;
