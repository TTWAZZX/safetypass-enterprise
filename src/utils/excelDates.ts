const DAY_IN_MS = 86_400_000;

type DateParts = {
  year: number;
  month: number;
  day: number;
};

const createLocalDateAtNoon = ({ year, month, day }: DateParts): Date | null => {
  if (![year, month, day].every(Number.isInteger)) return null;

  // Date treats years 0-99 as 1900-1999 when passed to its constructor. Keep
  // the parsed year literal so the validation below remains reliable.
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (year >= 0 && year < 100) date.setFullYear(year);

  if (
    Number.isNaN(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }

  return date;
};

const parseTextDate = (value: string): Date | null => {
  const text = value.trim();
  if (!text) return null;

  // Handle the ISO form before normalising separators. In particular, this
  // prevents YYYY-MM-DD from being mistaken for DD/MM/YYYY.
  const isoMatch = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (isoMatch) {
    return createLocalDateAtNoon({
      year: Number(isoMatch[1]),
      month: Number(isoMatch[2]),
      day: Number(isoMatch[3]),
    });
  }

  const localMatch = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text);
  if (!localMatch) return null;

  const first = Number(localMatch[1]);
  const second = Number(localMatch[2]);
  const parsedYear = Number(localMatch[3]);
  const year = localMatch[3].length === 2 ? 2000 + parsedYear : parsedYear;

  // The import is used in Thailand, so ambiguous values follow DD/MM/YYYY.
  // Still accept unambiguous MM/DD/YYYY input, e.g. 03/15/2026.
  const [day, month] = second > 12
    ? [second, first]
    : [first, second];

  return createLocalDateAtNoon({ year, month, day });
};

/**
 * Converts a date read from an Excel workbook to the ISO timestamp expected
 * by the staged-user RPC. ExcelJS can provide a serial number, Date instance,
 * or a text value depending on the source cell's formatting.
 */
export const processExcelDate = (excelDate: unknown): string | null => {
  if (excelDate === null || excelDate === undefined || excelDate === '') return null;

  let date: Date | null = null;

  if (typeof excelDate === 'number') {
    if (!Number.isFinite(excelDate)) return null;

    // 25569 is the Excel serial date for 1970-01-01. A fractional serial is
    // a time on that calendar day, not a reason to advance the expiry date.
    // Read UTC components so the serial represents the same day everywhere.
    const serialDay = Math.floor(excelDate);
    const serialDate = new Date((serialDay - 25569) * DAY_IN_MS);
    if (!Number.isNaN(serialDate.getTime())) {
      date = createLocalDateAtNoon({
        year: serialDate.getUTCFullYear(),
        month: serialDate.getUTCMonth() + 1,
        day: serialDate.getUTCDate(),
      });
    }
  } else if (typeof excelDate === 'string') {
    date = parseTextDate(excelDate);
  } else if (excelDate instanceof Date && !Number.isNaN(excelDate.getTime())) {
    date = createLocalDateAtNoon({
      year: excelDate.getFullYear(),
      month: excelDate.getMonth() + 1,
      day: excelDate.getDate(),
    });
  }

  return date ? date.toISOString() : null;
};
