/** Format the typed amount without changing its currency or numeric value. */
export function formatSalaryInput(value: unknown, currency: unknown = 'INR'): string {
  const raw = value == null ? '' : String(value);
  const digits = raw.replace(/,/g, '');
  // Keep text such as "12 LPA" intact for the existing conversational parser.
  if (!/^\d+(?:\.\d*)?$/.test(digits)) return raw;
  const [integer, fraction] = digits.split('.');
  const grouped = currency === 'USD'
    ? integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    : integer.length <= 3 ? integer
      : `${integer.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${integer.slice(-3)}`;
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/** Preserve the position within the amount when separators are inserted or removed. */
export function salaryCaretPosition(raw: string, formatted: string, caret: number): number {
  const count = raw.slice(0, caret).replace(/,/g, '').length;
  if (!count) return 0;
  let seen = 0;
  for (let index = 0; index < formatted.length; index++) {
    if (formatted[index] !== ',') seen++;
    if (seen === count) return index + 1;
  }
  return formatted.length;
}
