import React from 'react';
import { useTranslation } from '../context/LanguageContext';
import { Globe } from 'lucide-react';

const LanguageSwitcher: React.FC = () => {
  const { language, setLanguage } = useTranslation();

  return (
    <div className="flex items-center gap-2">
      {/* Icon Globe - ปรับให้พรีเมียมและแสดงผลเฉพาะบนจอที่ใหญ่ขึ้นเล็กน้อย */}
      <div className="hidden md:block">
        <Globe size={14} className="text-slate-500" />
      </div>

      {/* 💊 Sliding Pill Switcher Container */}
      <div className="relative flex items-center bg-slate-800 rounded-full p-1 border border-white/10 w-[86px] md:w-[100px] h-8 md:h-9 shadow-inner overflow-hidden">
        
        {/* 🚀 Sliding Highlight Layer: ตัวเลื่อนที่จะสไลด์ไปมาตามภาษาที่เลือก */}
        <div 
          className={`absolute h-[calc(100%-8px)] w-[calc(50%-4px)] bg-blue-600 rounded-full shadow-lg shadow-blue-500/40 transition-all duration-300 ease-out ${
            language === 'en' ? 'translate-x-full' : 'translate-x-0'
          }`}
        />

        {/* TH Button */}
        <button
          type="button"
          onClick={() => setLanguage('th')}
          className={`relative z-10 flex-1 text-[10px] md:text-xs font-black transition-all duration-300 active:scale-90 ${
            language === 'th' 
              ? 'text-white' 
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          TH
        </button>
        
        {/* EN Button */}
        <button
          type="button"
          onClick={() => setLanguage('en')}
          className={`relative z-10 flex-1 text-[10px] md:text-xs font-black transition-all duration-300 active:scale-90 ${
            language === 'en' 
              ? 'text-white' 
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          EN
        </button>
      </div>
    </div>
  );
};

export default LanguageSwitcher;
