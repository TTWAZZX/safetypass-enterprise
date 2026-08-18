import { describe, expect, it } from 'vitest';
import {
  getRegistrationDisabledReason, getRegistrationDisabledReasons,
  getRegistrationStepIndex, isValidRegistrationAge,
} from '../services/registrationProgress';

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
    expect(getRegistrationDisabledReason({ ...complete, vendorId: '' })).toContain('เลือกบริษัท');
    expect(getRegistrationDisabledReason({ ...complete, pdpaAccepted: false })).toContain('นโยบายความเป็นส่วนตัว');
    expect(getRegistrationDisabledReason({ ...complete, selectedPrograms: [] })).toContain('หลักสูตร');
    expect(getRegistrationDisabledReason({ ...complete, securePin: '123456' })).toContain('PIN');
    expect(getRegistrationDisabledReason({ ...complete, securePinConfirmation: '135790' })).toContain('PIN');
    expect(getRegistrationDisabledReason(complete)).toBeNull();
  });

  it('shows every remaining requirement instead of hiding all but the first one', () => {
    const reasons = getRegistrationDisabledReasons({
      ...complete,
      vendorId: '',
      selectedPrograms: [],
      securePin: '123',
      securePinConfirmation: '',
      pdpaAccepted: false,
    });

    expect(reasons).toHaveLength(4);
    expect(reasons.join(' ')).toContain('เลือกบริษัท');
    expect(reasons.join(' ')).toContain('หลักสูตร');
    expect(reasons.join(' ')).toContain('PIN');
    expect(reasons.join(' ')).toContain('นโยบายความเป็นส่วนตัว');
  });

  it.each(['', '0', '-1', '25.5', '121', 'not-a-number'])(
    'rejects an invalid registration age %s',
    (age) => {
      expect(isValidRegistrationAge(age)).toBe(false);
      expect(getRegistrationDisabledReason({ ...complete, age })).toContain('1–120');
    },
  );

  it.each(['1', '25', '120'])(
    'accepts a valid registration age %s',
    (age) => expect(isValidRegistrationAge(age)).toBe(true),
  );
});
