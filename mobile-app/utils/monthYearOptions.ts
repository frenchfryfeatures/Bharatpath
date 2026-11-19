/** Ending months are strictly after `after` and employment dates cannot be in the future. */
export function monthYearOptions(year: string, after = "", now = new Date(), oldestYear = 1900) {
  const minimum = /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(after) ? after : "";
  const maximum = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const allowed = (candidateYear: string, month: string) => {
    const date = `${candidateYear}-${month}`;
    return date <= maximum && (!minimum || date > minimum);
  };
  const years = Array.from({length: Math.max(0, now.getFullYear() - oldestYear + 1)}, (_, index) => String(now.getFullYear() - index))
    .filter((item) => allowed(item, "12") || Array.from({length: 12}, (_, index) => String(index + 1).padStart(2, "0")).some((month) => allowed(item, month)));
  const months = Array.from({length: 12}, (_, index) => String(index + 1).padStart(2, "0"))
    .filter((month) => year ? years.includes(year) && allowed(year, month) : years.some((item) => allowed(item, month)));
  return {years, months};
}
