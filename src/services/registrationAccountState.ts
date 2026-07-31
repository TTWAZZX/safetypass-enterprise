export type RegistrationAccountState =
  | 'NOT_FOUND'
  | 'STAGED'
  | 'REGISTERED'
  | 'SUSPENDED';

export interface RegistrationStatusRow {
  user_exists?: boolean | null;
  requires_registration?: boolean | null;
  is_active?: boolean | null;
}

export interface RegistrationStatus {
  state: RegistrationAccountState;
  userExists: boolean;
  requiresRegistration: boolean;
  isActive: boolean;
}

export interface StagedRegistrationProfile {
  name: string;
  age: number | null;
  nationality: string | null;
  vendor_id: string | null;
  vendor: {
    id: string;
    name: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
  } | null;
}

/**
 * Converts the privacy-safe public lookup response into the one account-state
 * contract used by both login and registration.
 */
export const resolveRegistrationStatus = (
  row?: RegistrationStatusRow | null,
): RegistrationStatus => {
  if (!row?.user_exists) {
    return {
      state: 'NOT_FOUND',
      userExists: false,
      requiresRegistration: true,
      isActive: true,
    };
  }

  if (row.is_active === false) {
    return {
      state: 'SUSPENDED',
      userExists: true,
      requiresRegistration: Boolean(row.requires_registration),
      isActive: false,
    };
  }

  if (row.requires_registration === true) {
    return {
      state: 'STAGED',
      userExists: true,
      requiresRegistration: true,
      isActive: true,
    };
  }

  return {
    state: 'REGISTERED',
    userExists: true,
    requiresRegistration: false,
    isActive: true,
  };
};
