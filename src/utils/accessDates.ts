export const getTodayIsoDate = (now = new Date()): string => {
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
};

export const addOneYearIsoDate = (isoDate: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return '';

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const target = new Date(Date.UTC(year + 1, month - 1, day));

  // Keep leap-day access within February in a non-leap target year.
  if (target.getUTCMonth() !== month - 1) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
};
