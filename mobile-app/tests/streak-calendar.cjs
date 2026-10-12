const assert = require('assert');

// 1. Date math and helpers
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function parseDateKey(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toDateKey(value) {
  return value.toISOString().slice(0, 10);
}

function addDays(value, days) {
  return new Date(value.getTime() + days * DAY_IN_MS);
}

function calendarArgsFor(period, today) {
  if (period === 'year') {
    const year = today.slice(0, 4);
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  return { period, date: today };
}

// Test calendarArgsFor
const today = '2026-10-09';
const weekArgs = calendarArgsFor('week', today);
assert.deepStrictEqual(weekArgs, { period: 'week', date: '2026-10-09' });

const monthArgs = calendarArgsFor('month', today);
assert.deepStrictEqual(monthArgs, { period: 'month', date: '2026-10-09' });

const yearArgs = calendarArgsFor('year', today);
assert.deepStrictEqual(yearArgs, { from: '2026-01-01', to: '2026-12-31' });

// Test Week days generation for 2026-10-09 (Friday)
const todayDate = parseDateKey(today);
const weekday = todayDate.getUTCDay(); // 5 = Friday
assert.strictEqual(weekday, 5);
const mondayOffset = weekday === 0 ? -6 : 1 - weekday; // 1 - 5 = -4
const monday = addDays(todayDate, mondayOffset);
const weekDays = Array.from({ length: 7 }, (_, i) => toDateKey(addDays(monday, i)));
assert.deepStrictEqual(weekDays, [
  '2026-10-05',
  '2026-10-06',
  '2026-10-07',
  '2026-10-08',
  '2026-10-09',
  '2026-10-10',
  '2026-10-11',
]);

// Test Month days generation for October 2026
const year = todayDate.getUTCFullYear();
const month = todayDate.getUTCMonth();
const firstDay = new Date(Date.UTC(year, month, 1));
const lastDay = new Date(Date.UTC(year, month + 1, 0));
assert.strictEqual(lastDay.getUTCDate(), 31, 'October has 31 days');

const firstWeekday = firstDay.getUTCDay();
const firstMondayOffset = firstWeekday === 0 ? -6 : 1 - firstWeekday;
const firstMonday = addDays(firstDay, firstMondayOffset);
const dayCount = Math.round((lastDay.getTime() - firstMonday.getTime()) / DAY_IN_MS) + 1;
const totalGridDays = Math.ceil(dayCount / 7) * 7;
const monthDays = Array.from({ length: totalGridDays }, (_, i) => addDays(firstMonday, i));

// Oct 1 is Thursday -> Mon, Tue, Wed of first week are in Sept
assert.strictEqual(monthDays[0].getUTCMonth(), 8); // September (0-indexed 8)
assert.strictEqual(toDateKey(monthDays[3]), '2026-10-01');
assert.strictEqual(toDateKey(monthDays[33]), '2026-10-31');

// Test active count calculation
const mockActiveDates = new Set(['2026-10-08', '2026-10-09']);
const activeMonthCount = monthDays.filter(
  (d) => d.getUTCMonth() === month && mockActiveDates.has(toDateKey(d)),
).length;
assert.strictEqual(activeMonthCount, 2);

// Test Year weeks generation
const yearStart = new Date(Date.UTC(year, 0, 1));
const yearEnd = new Date(Date.UTC(year, 11, 31));
const yearFirstWeekday = yearStart.getUTCDay();
const yearMondayOffset = yearFirstWeekday === 0 ? -6 : 1 - yearFirstWeekday;
const yearFirstMonday = addDays(yearStart, yearMondayOffset);
const yearDayCount = Math.round((yearEnd.getTime() - yearFirstMonday.getTime()) / DAY_IN_MS) + 1;
const yearTotalDays = Math.ceil(yearDayCount / 7) * 7;
const yearAllDays = Array.from({ length: yearTotalDays }, (_, i) => addDays(yearFirstMonday, i));
const yearWeeks = Array.from({ length: yearAllDays.length / 7 }, (_, i) =>
  yearAllDays.slice(i * 7, i * 7 + 7),
);

assert(yearWeeks.length >= 52 && yearWeeks.length <= 54, 'Year has 52-54 weeks in grid');
assert(yearAllDays.some((d) => toDateKey(d) === '2026-01-01'));
assert(yearAllDays.some((d) => toDateKey(d) === '2026-12-31'));

const yearActiveCount = yearAllDays.filter(
  (d) => d.getUTCFullYear() === year && mockActiveDates.has(toDateKey(d)),
).length;
assert.strictEqual(yearActiveCount, 2);

console.log('Streak calendar week/month/year tests passed successfully!');
