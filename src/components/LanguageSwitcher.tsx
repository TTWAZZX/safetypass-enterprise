import React from 'react';
import { useTranslation } from '../context/LanguageContext';
import { Globe } from 'lucide-react';

const LanguageSwitcher: React.FC = () => {
  const { language, setLanguage } = useTranslation();

  return (
    <div className="flex items-center gap-2 bg-white/10 rounded-full p-1 border border-white/20">
      <Globe className="w-4 h-4 text-white ml-2" />
      <button
        onClick={() => setLanguage('th')}
        className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${language === 'th' ? 'bg-white text-blue-900 shadow-sm' : 'text-white hover:bg-white/10'}`}
      >
        TH
      </button>
      <button
        onClick={() => setLanguage('en')}
        className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${language === 'en' ? 'bg-white text-blue-900 shadow-sm' : 'text-white hover:bg-white/10'}`}
      >
        EN
      </button>
    </div>
  );
};

export default LanguageSwitcher;