import { describe, expect, it } from 'vitest';
import { getRegistrationDisabledReason, getRegistrationStepIndex } from '../services/registrationProgress';

const complete = {
  loading: false,
  regId: '1234567890123',
  name: 'ผู้ใช้ทดสอบ',
  age: '30',
  nationality: 'ไทย (Thai)',
  vendorId: 'vendor-1',
  otherVendor: '',
  supplierOutsourceEnabled: true,
  selectedPrograms: ['CONTRACTOR'] as any[],
  accessStartDate: '',
  accessEndDate: '',
  pdpaAccepted: true,
  securePin: '246801',
  securePinConfirmation: '246801',
};

describe('registration progress', () => {
  it('identifies the current registration step', () => {
    expect(getRegistrationStepIndex({ ...complete, regId: '' })).toBe(0);
    expect(getRegistrationStepIndex({ ...complete, vendorId: '' })).toBe(1);
    expect(getRegistrationStepIndex(complete)).toBe(2);
  });

  it('explains why registration is disabled', () => {
    expect(getRegistrationDisabledReason({ ...complete, vendorId: '' })).toBe('เลือกบริษัทก่อน');
    expect(getRegistrationDisabledReason({ ...complete, pdpaAccepted: false })).toContain('นโยบายความเป็นส่วนตัว');
    expect(getRegistrationDisabledReason({ ...complete, selectedPrograms: [] })).toContain('หลักสูตร');
    expect(getRegistrationDisabledReason({ ...complete, securePin: '123456' })).toContain('PIN');
    expect(getRegistrationDisabledReason({ ...complete, securePinConfirmation: '135790' })).toContain('PIN');
    expect(getRegistrationDisabledReason(complete)).toBeNull();
  });
});
