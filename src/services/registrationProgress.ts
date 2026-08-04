import { TrainingProgram } from '../types';
import { getSecurePinError } from './pinSecurity';

interface RegistrationProgressInput {
  loading: boolean;
  regId: string;
  name: string;
  age: string;
  nationality: string;
  vendorId: string;
  otherVendor: string;
  supplierOutsourceEnabled: boolean;
  selectedPrograms: TrainingProgram[];
  accessStartDate: string;
  accessEndDate: string;
  pdpaAccepted: boolean;
  securePin: string;
  securePinConfirmation: string;
}

export const getRegistrationDisabledReason = (input: RegistrationProgressInput): string | null => {
  if (input.loading) return 'กำลังสร้างบัญชี กรุณารอสักครู่';
  if (input.regId.length !== 13) return 'กรอกเลขบัตรประจำตัวให้ครบ 13 หลัก';
  if (!input.name.trim()) return 'กรอกชื่อและนามสกุล';
  if (!input.age || Number(input.age) <= 0) return 'กรอกอายุให้ถูกต้อง';
  if (!input.nationality.trim()) return 'ระบุสัญชาติ';
  const pinError = getSecurePinError(input.regId, input.securePin);
  if (pinError) return pinError;
  if (input.securePin !== input.securePinConfirmation) return 'PIN ใหม่และการยืนยัน PIN ไม่ตรงกัน';
  if (!input.vendorId) return 'เลือกบริษัทก่อน';
  if (input.vendorId === 'OTHER' && !input.otherVendor.trim()) return 'ระบุชื่อบริษัทใหม่';
  if (input.supplierOutsourceEnabled && input.selectedPrograms.length === 0) return 'เลือกหลักสูตรอย่างน้อย 1 รายการ';
  if (input.accessStartDate && input.accessEndDate && input.accessEndDate < input.accessStartDate) return 'วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น';
  if (!input.pdpaAccepted) return 'ยอมรับนโยบายความเป็นส่วนตัวก่อนลงทะเบียน';
  return null;
};

export const getRegistrationStepIndex = (input: Omit<RegistrationProgressInput, 'loading' | 'pdpaAccepted'>): number => {
  const identityComplete = input.regId.length === 13
    && Boolean(input.name.trim())
    && Boolean(input.age && Number(input.age) > 0)
    && Boolean(input.nationality.trim())
    && !getSecurePinError(input.regId, input.securePin)
    && input.securePin === input.securePinConfirmation;
  if (!identityComplete) return 0;

  const companyComplete = Boolean(input.vendorId)
    && (input.vendorId !== 'OTHER' || Boolean(input.otherVendor.trim()))
    && (!input.supplierOutsourceEnabled || input.selectedPrograms.length > 0)
    && !(input.accessStartDate && input.accessEndDate && input.accessEndDate < input.accessStartDate);
  return companyComplete ? 2 : 1;
};
