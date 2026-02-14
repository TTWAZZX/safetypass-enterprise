import React, { createContext, useContext, useState, ReactNode } from 'react';

// 1. กำหนดชนิดข้อมูล
type Language = 'th' | 'en';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

// 2. คำแปลภาษา (Dictionary)
const translations = {
  th: {
    'app.name': 'ระบบความปลอดภัยผู้รับเหมา',
    'app.tagline': 'มาตรฐานความปลอดภัยระดับองค์กร',
    'auth.login': 'เข้าสู่ระบบ',
    'auth.register': 'ลงทะเบียน',
    'auth.national_id': 'เลขบัตรประชาชน',
    'auth.full_name': 'ชื่อ-นามสกุล',
    'auth.company': 'บริษัท (Vendor)',
    'auth.other_company': 'ชื่อบริษัทอื่นๆ (ระบุ)',
    'auth.error.exists': 'มีผู้ใช้งานนี้ในระบบแล้ว',
    'auth.error.notfound': 'ไม่พบผู้ใช้งาน',
    'user.status.active': 'สถานะปกติ',
    'user.status.inactive': 'หมดอายุ',
    'user.stage1': 'ขั้นตอนที่ 1: อบรมความปลอดภัย (รายปี)',
    'user.stage2': 'ขั้นตอนที่ 2: ใบอนุญาตเข้างาน (5 วัน)',
    'user.expiry': 'หมดอายุวันที่',
    'user.permit_no': 'เลขที่ใบงาน (Work Permit No.)',
    'user.manual': 'คู่มือความปลอดภัย', 
    'user.read_manual': 'กรุณาอ่านคู่มือให้จบเพื่อเริ่มสอบ',
    'exam.start': 'เริ่มทำข้อสอบ',
    'exam.submit': 'ส่งคำตอบ',
    'exam.pass': 'สอบผ่าน!',
    'exam.fail': 'ไม่ผ่าน เกณฑ์คะแนนไม่ถึง',
    'admin.dashboard': 'แดชบอร์ด',
    'admin.vendors': 'อนุมัติผู้รับเหมา',
    'admin.reports': 'รายงาน',
    'admin.export_excel': 'ดาวน์โหลด Excel',
    'admin.export_pdf': 'ดาวน์โหลด PDF',
    'common.back': 'กลับ',
    'common.logout': 'ออกจากระบบ',
    'common.loading': 'กำลังโหลด...'
  },
  en: {
    'app.name': 'Contractor Safety Passport',
    'app.tagline': 'Enterprise Safety Standard',
    'auth.login': 'Login',
    'auth.register': 'Register',
    'auth.national_id': 'National ID',
    'auth.full_name': 'Full Name',
    'auth.company': 'Vendor',
    'auth.other_company': 'Other Company Name',
    'auth.error.exists': 'User already exists',
    'auth.error.notfound': 'User not found',
    'user.status.active': 'Active',
    'user.status.inactive': 'Expired',
    'user.stage1': 'Stage 1: Safety Induction (Annual)',
    'user.stage2': 'Stage 2: Work Permit (5-Day)',
    'user.expiry': 'Expires',
    'user.permit_no': 'Work Permit No.',
    'user.manual': 'Safety Manual',
    'user.read_manual': 'Please read manual to start exam',
    'exam.start': 'Start Exam',
    'exam.submit': 'Submit Answers',
    'exam.pass': 'Passed!',
    'exam.fail': 'Failed',
    'admin.dashboard': 'Dashboard',
    'admin.vendors': 'Vendor Approval',
    'admin.reports': 'Reports',
    'admin.export_excel': 'Export Excel',
    'admin.export_pdf': 'Export PDF',
    'common.back': 'Back',
    'common.logout': 'Logout',
    'common.loading': 'Loading...'
  }
};

// 3. สร้าง Context
const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

// 4. สร้าง Provider
export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>('th');

  const t = (key: string) => {
    return translations[language][key as keyof typeof translations['th']] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

// 5. สร้าง Hook (ตัวนี้แหละที่หายไป!)
export const useTranslation = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useTranslation must be used within a LanguageProvider');
  return context;
};