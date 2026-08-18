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

export const isValidRegistrationAge = (
  value: string | number | null | undefined,
): boolean => {
  if (value === '' || value == null) return false;
  const numericAge = Number(value);
  return Number.isInteger(numericAge) && numericAge >= 1 && numericAge <= 120;
};

export const getRegistrationDisabledReasons = (input: RegistrationProgressInput): string[] => {
  const reasons: string[] = [];
  if (input.loading) reasons.push('กำลังสร้างบัญชี กรุณารอสักครู่');
  if (input.regId.length !== 13) reasons.push('กรอกเลขบัตรประจำตัวให้ครบ 13 หลัก');
  if (!input.name.trim()) reasons.push('กรอกชื่อและนามสกุล');
  if (!isValidRegistrationAge(input.age)) reasons.push('กรอกอายุเป็นจำนวนเต็มระหว่าง 1–120 ปี');
  if (!input.nationality.trim()) reasons.push('ระบุสัญชาติ');
  if (!input.vendorId) reasons.push('ค้นหาแล้วเลือกบริษัทจากรายการด้านล่าง');
  if (input.vendorId === 'OTHER' && !input.otherVendor.trim()) reasons.push('ระบุชื่อบริษัทใหม่');
  if (input.supplierOutsourceEnabled && input.selectedPrograms.length === 0) reasons.push('เลือกหลักสูตรอย่างน้อย 1 รายการ');
  if (input.accessStartDate && input.accessEndDate && input.accessEndDate < input.accessStartDate) reasons.push('วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น');
  const pinError = getSecurePinError(input.regId, input.securePin);
  if (pinError) reasons.push(pinError);
  else if (input.securePin !== input.securePinConfirmation) reasons.push('PIN ใหม่และการยืนยัน PIN ไม่ตรงกัน');
  if (!input.pdpaAccepted) reasons.push('ยอมรับนโยบายความเป็นส่วนตัวก่อนลงทะเบียน');
  return reasons;
};

export const getRegistrationDisabledReason = (input: RegistrationProgressInput): string | null => {
  return getRegistrationDisabledReasons(input)[0] || null;
};

export const getRegistrationStepIndex = (input: Omit<RegistrationProgressInput, 'loading' | 'pdpaAccepted'>): number => {
  const identityComplete = input.regId.length === 13
    && Boolean(input.name.trim())
    && isValidRegistrationAge(input.age)
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
