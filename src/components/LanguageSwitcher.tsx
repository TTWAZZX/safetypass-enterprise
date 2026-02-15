import React from 'react';
import { useTranslation } from '../context/LanguageContext';
import { Globe } from 'lucide-react';

const LanguageSwitcher: React.FC = () => {
  const { language, setLanguage } = useTranslation();

  return (
    <div className="flex items-center bg-slate-800/40 backdrop-blur-md rounded-xl p-0.5 border border-white/10 shadow-inner">
      {/* Icon Globe - ปรับให้เล็กลงและดูพรีเมียม */}
      <div className="px-1.5 hidden md:block">
        <Globe size={12} className="text-slate-400" />
      </div>

      <div className="flex items-center">
        <button
          onClick={() => setLanguage('th')}
          className={`px-2.5 py-1 md:px-3 md:py-1.5 rounded-lg text-[10px] md:text-xs font-black transition-all duration-300 active:scale-90 ${
            language === 'th' 
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' 
              : 'text-slate-400 hover:text-white'
          }`}
        >
          TH
        </button>
        
        <button
          onClick={() => setLanguage('en')}
          className={`px-2.5 py-1 md:px-3 md:py-1.5 rounded-lg text-[10px] md:text-xs font-black transition-all duration-300 active:scale-90 ${
            language === 'en' 
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' 
              : 'text-slate-400 hover:text-white'
          }`}
        >
          EN
        </button>
      </div>
    </div>
  );
};

export default LanguageSwitcher;