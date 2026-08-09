export type PinConfirmationState = 'EMPTY' | 'INCOMPLETE' | 'MATCH' | 'MISMATCH';

export const getPinConfirmationState = (
  pin: string,
  confirmation: string,
): PinConfirmationState => {
  if (!confirmation) return 'EMPTY';
  if (pin.length !== 6 || confirmation.length !== 6) return 'INCOMPLETE';
  return pin === confirmation ? 'MATCH' : 'MISMATCH';
};
