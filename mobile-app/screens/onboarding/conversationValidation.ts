import type { CareerDetails, CareerField } from '@/services/api/career';

export type CareerDetailValue = string | number | string[] | null;

export type ParsedAnswer =
  | { value: CareerDetailValue; error?: undefined }
  | { error: string; value?: undefined };

const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function applyCareerAnswer(
  details: CareerDetails,
  key: string,
  value: CareerDetails[string],
): CareerDetails {
  const next = { ...details, [key]: value };
  if (key === 'work_status' && value === 'FRESHER') {
    Object.assign(next, {
      experience_years: 0,
      experience_months: 0,
      currently_employed: 'NO',
      company_name: '',
      job_title: '',
      employment_start: '',
      employment_end: '',
      annual_salary: null,
      notice_period: '',
      job_role: '',
    });
  }
  if (key === 'currently_employed' && value === 'YES') {
    next.employment_end = '';
    next.work_status = 'EXPERIENCED';
  }
  if (key === 'currently_employed' && value === 'NO') {
    Object.assign(next, {
      company_name: '',
      job_title: '',
      employment_start: '',
      employment_end: '',
      annual_salary: null,
      notice_period: '',
      job_role: '',
    });
  }
  return next;
}

export const MAX_PROFILE_RUPEES = 1_000_000_000; // 100 Crore

/**
 * Format raw salary rupees into human-readable Indian display string (e.g. ₹77 LPA or ₹1.5 Cr).
 */
export function formatSalaryDisplay(rupees: number | null | undefined): string {
  if (rupees == null || !Number.isFinite(rupees)) return 'Not specified';
  if (rupees === 0) return '₹0';
  const lpa = rupees / 100_000;
  if (lpa >= 100) {
    const cr = rupees / 10_000_000;
    const crStr = cr % 1 === 0 ? cr.toFixed(0) : cr.toFixed(2);
    return `₹${crStr} Cr`;
  }
  const lpaStr = lpa % 1 === 0 ? lpa.toFixed(0) : lpa.toFixed(2);
  return `₹${lpaStr} LPA`;
}

/**
 * Robust salary parser that accepts:
 * - LPA / Lakhs (e.g. "77LPA", "77 LPA", "12 Lakhs", "6.5 lpa")
 * - Crores (e.g. "1.5 Cr", "1.5cr", "1.2 Crore")
 * - Thousands / K (e.g. "50k", "50 thousand")
 * - Monthly amounts (e.g. "50,000 per month", "50k/month", "50k pm", "40000 monthly") -> converted to annual (* 12)
 * - Plain numbers (e.g. "77" or "12" -> LPA; "7700000" or "600000" -> raw rupees)
 */
export function parseSalaryInput(raw: string): ParsedAnswer {
  const text = raw.trim();
  if (!text) {
    return {
      error: 'Please enter a salary, for example: 12 LPA, 50k/month, or ₹6,00,000.',
    };
  }

  // Clean currency symbols, commas, spaces
  let cleaned = text
    .replace(/[₹$€£]/g, '')
    .replace(/\b(?:rs\.?|inr)\b/gi, '')
    .replace(/,/g, '')
    .trim();

  // Check for monthly indicators: per month, /month, /mo, pm, monthly
  const isMonthly = /\b(?:per\s*month|\/\s*month|\/\s*mo|pm|p\.m\.|monthly)\b/i.test(
    cleaned,
  );
  // Strip monthly indicators
  cleaned = cleaned
    .replace(
      /\b(?:per\s*month|\/\s*month|\/\s*mo|pm|p\.m\.|monthly)\b/gi,
      '',
    )
    .trim();

  // Check and strip annual indicators: per year, /year, /yr, per annum, annually, annual, p.a.
  cleaned = cleaned
    .replace(
      /\b(?:per\s*year|\/\s*year|\/\s*yr|per\s*annum|annually|annual|p\.a\.)\b/gi,
      '',
    )
    .trim();

  // Check Crore: e.g. "1.5 Cr", "1.5cr", "1.5 crore", "1.5 crores"
  const crMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*(?:cr(?:ores?)?)$/i);
  if (crMatch) {
    const crValue = Number(crMatch[1]);
    if (!Number.isFinite(crValue) || crValue <= 0) {
      return { error: 'Please enter a valid salary amount in Crores (e.g. 1.5 Cr).' };
    }
    const monthlyMultiplier = isMonthly ? 12 : 1;
    const rupees = Math.round(crValue * 10_000_000 * monthlyMultiplier);
    if (rupees > MAX_PROFILE_RUPEES) {
      return { error: 'Salary exceeds the maximum allowed limit of ₹100 Crore.' };
    }
    return { value: rupees };
  }

  // Check LPA / Lakh: e.g. "77LPA", "77 LPA", "12 Lakhs", "12 lakh", "12 lac", "12 lacs", "12l", "12 l"
  const lpaMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|lacs?|l)$/i);
  if (lpaMatch) {
    const lpaValue = Number(lpaMatch[1]);
    if (!Number.isFinite(lpaValue) || lpaValue <= 0) {
      return { error: 'Please enter a valid salary amount (e.g. 12 LPA).' };
    }
    const monthlyMultiplier = isMonthly ? 12 : 1;
    const rupees = Math.round(lpaValue * 100_000 * monthlyMultiplier);
    if (rupees > MAX_PROFILE_RUPEES) {
      return { error: 'Salary exceeds the maximum allowed limit of ₹100 Crore.' };
    }
    return { value: rupees };
  }

  // Check Thousands / K: e.g. "50k", "50 k", "50 thousand", "50 thousands"
  const kMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*(?:k|thousands?)$/i);
  if (kMatch) {
    const kValue = Number(kMatch[1]);
    if (!Number.isFinite(kValue) || kValue <= 0) {
      return { error: 'Please enter a valid salary amount (e.g. 50k/month or 600k).' };
    }
    const monthlyMultiplier = isMonthly ? 12 : 1;
    const rupees = Math.round(kValue * 1_000 * monthlyMultiplier);
    if (rupees > MAX_PROFILE_RUPEES) {
      return { error: 'Salary exceeds the maximum allowed limit of ₹100 Crore.' };
    }
    return { value: rupees };
  }

  // Check pure numbers: e.g. "77", "12", "6.5", "50000", "7700000"
  if (/^\d+(?:\.\d+)?$/.test(cleaned)) {
    const num = Number(cleaned);
    if (!Number.isFinite(num) || num < 0) {
      return { error: 'Please enter a valid positive salary amount.' };
    }

    if (num === 0) {
      return { value: 0 };
    }

    let rupees: number;
    if (isMonthly) {
      // Monthly specified without unit, e.g. "50000 per month" or "1.5 per month"
      if (num <= 500) {
        // e.g. 1.5 per month = 1.5 Lakhs/month = 18 LPA
        rupees = Math.round(num * 100_000 * 12);
      } else {
        // e.g. 50000 per month = 6,00,000
        rupees = Math.round(num * 12);
      }
    } else {
      // Annual
      if (num <= 500) {
        // In Indian context, entering 77 or 12 or 6.5 for annual salary means LPA!
        rupees = Math.round(num * 100_000);
      } else if (num >= 10_000) {
        // e.g. 600000 or 7700000 -> whole rupees
        rupees = Math.round(num);
      } else {
        // Between 501 and 9999 (e.g. 2000): Ambiguous
        return {
          error:
            'Please specify salary units, for example: 12 LPA, 50k/month, or ₹6,00,000.',
        };
      }
    }

    if (rupees > MAX_PROFILE_RUPEES) {
      return { error: 'Salary exceeds the maximum allowed limit of ₹100 Crore.' };
    }
    return { value: rupees };
  }

  return {
    error:
      'Please enter your salary in a standard format, for example: 12 LPA, 77LPA, 50k/month, 1.5 Cr, or ₹7,00,000.',
  };
}

/**
 * Normalise flexible month input (YYYY-MM, YYYY/MM, MM/YYYY, Month YYYY) into YYYY-MM.
 */
export function parseMonthInput(raw: string): string | null {
  const text = raw.trim();
  // Standard YYYY-MM
  if (/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(text)) {
    return text;
  }
  // YYYY-M or YYYY/M or YYYY/MM
  const slashMatch = text.match(/^((?:19|20)\d{2})[-/](0?[1-9]|1[0-2])$/);
  if (slashMatch) {
    return `${slashMatch[1]}-${slashMatch[2].padStart(2, '0')}`;
  }
  // MM/YYYY or M/YYYY
  const reverseMatch = text.match(/^(0?[1-9]|1[0-2])[-/]((?:19|20)\d{2})$/);
  if (reverseMatch) {
    return `${reverseMatch[2]}-${reverseMatch[1].padStart(2, '0')}`;
  }
  // Month Name + Year e.g. "June 2024", "Jun 2024", "2024 June"
  const monthNames: Record<string, string> = {
    jan: '01', january: '01',
    feb: '02', february: '02',
    mar: '03', march: '03',
    apr: '04', april: '04',
    may: '05',
    jun: '06', june: '06',
    jul: '07', july: '07',
    aug: '08', august: '08',
    sep: '09', sept: '09', september: '09',
    oct: '10', october: '10',
    nov: '11', november: '11',
    dec: '12', december: '12',
  };
  const parts = text.toLowerCase().split(/[\s,]+/);
  if (parts.length === 2) {
    const [p1, p2] = parts;
    if (monthNames[p1] && /^(?:19|20)\d{2}$/.test(p2)) {
      return `${p2}-${monthNames[p1]}`;
    }
    if (/^(?:19|20)\d{2}$/.test(p1) && monthNames[p2]) {
      return `${p1}-${monthNames[p2]}`;
    }
  }
  return null;
}

/**
 * Deterministic parsing: never guess values that do not match an option.
 */
export function parseConversationAnswer(
  field: CareerField,
  raw: string,
  required: boolean,
  details: CareerDetails,
): ParsedAnswer {
  const text = raw.trim();
  if (!text) {
    if (required) {
      return { error: 'Please enter an answer or choose a suggestion.' };
    }
    return {
      value:
        field.type === 'list'
          ? []
          : field.type === 'number'
            ? field.key.startsWith('experience_')
              ? 0
              : null
            : '',
    };
  }

  if (field.type === 'select') {
    const input = normalise(text);
    const aliases: Record<string, Record<string, string>> = {
      work_status: {
        fresher: 'FRESHER',
        'a fresher': 'FRESHER',
        experienced: 'EXPERIENCED',
        'i have experience': 'EXPERIENCED',
      },
      currently_employed: {
        'i am working': 'YES',
        'im working': 'YES',
        yes: 'YES',
        'not working': 'NO',
        'i am not working': 'NO',
        no: 'NO',
      },
    };
    const option = field.options.find(
      (item) =>
        normalise(item.label) === input ||
        normalise(item.value) === input ||
        aliases[field.key]?.[input] === item.value,
    );
    return option
      ? { value: option.value }
      : {
          error: `Please choose or type one of: ${field.options
            .map((item) => item.label)
            .join(', ')}.`,
        };
  }

  if (field.type === 'number') {
    // Salary fields support LPA, Cr, K, monthly, and rupees
    if (field.key === 'annual_salary' || field.key === 'preferred_salary') {
      return parseSalaryInput(text);
    }

    if (!/^\d+$/.test(text)) {
      return { error: 'Please enter a whole number using digits.' };
    }
    const value = Number(text);
    const currentYear = new Date().getFullYear();
    const min = field.key.endsWith('year') ? 1950 : 0;
    const max =
      field.key === 'experience_months'
        ? 11
        : field.key === 'experience_years'
          ? 60
          : field.key === 'starting_year'
            ? currentYear
            : field.key === 'passing_year'
              ? currentYear + 7
              : 1_000_000_000;

    if (field.key === 'starting_year' && value > currentYear) {
      return { error: 'The starting year cannot be in the future.' };
    }

    if (!Number.isSafeInteger(value) || value < min || value > max) {
      if (field.key === 'starting_year') {
        return { error: `Please enter a valid starting year from ${min} up to ${currentYear}.` };
      }
      if (field.key === 'passing_year') {
        return { error: `Please enter a valid graduation year from ${min} up to ${max}.` };
      }
      return { error: `Please enter a whole number from ${min} to ${max}.` };
    }

    if (field.key === 'passing_year' && Number(details.starting_year) > value) {
      return {
        error:
          'Your passing year must be the same as or later than your starting year.',
      };
    }
    if (
      field.key === 'starting_year' &&
      details.passing_year &&
      value > Number(details.passing_year)
    ) {
      return {
        error:
          'Your starting year must be the same as or earlier than your passing year.',
      };
    }
    if (
      field.key === 'passing_year' &&
      details.starting_year &&
      value > Number(details.starting_year) + 7
    ) {
      return {
        error:
          `Your graduation year must be within 7 years of your starting year (${details.starting_year}).`,
      };
    }
    if (
      field.key === 'experience_months' &&
      details.work_status === 'EXPERIENCED' &&
      !Number(details.experience_years) &&
      !value
    ) {
      return {
        error:
          'Enter at least one month of experience, or update your work status to fresher.',
      };
    }
    return { value };
  }

  if (field.type === 'month') {
    const parsedMonth = parseMonthInput(text);
    if (!parsedMonth) {
      return {
        error: 'Please enter a month as YYYY-MM, for example 2024-06.',
      };
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthNum = now.getMonth() + 1;
    const currentYearMonth = `${currentYear}-${String(currentMonthNum).padStart(2, '0')}`;

    if (parsedMonth > currentYearMonth) {
      if (field.key === 'employment_start') {
        return {
          error:
            'The starting month cannot be in the future. Till current month allowed only.',
        };
      }
      if (field.key === 'employment_end') {
        return {
          error:
            'The ending month cannot be in the future. Till current month allowed only.',
        };
      }
      return {
        error: 'The date cannot be in the future. Till current month allowed only.',
      };
    }

    if (
      field.key === 'employment_end' &&
      details.employment_start &&
      parsedMonth < String(details.employment_start)
    ) {
      return {
        error: 'The ending month must be the same as or after the starting month.',
      };
    }
    return { value: parsedMonth };
  }

  if (field.type === 'tel') {
    return /^\+[1-9]\d{7,14}$/.test(text)
      ? { value: text }
      : { error: 'Use international format, for example +919876543210.' };
  }

  if (field.type === 'list') {
    const values = [
      ...new Set(
        text
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
    const maxItems = field.key === 'preferred_locations' ? 5 : 100;
    const maxLength = field.key === 'preferred_locations' ? 100 : 80;
    if (
      !values.length ||
      values.length > maxItems ||
      values.some((item) => item.length > maxLength)
    ) {
      return {
        error: `Enter up to ${maxItems} comma-separated items, each with 1–${maxLength} characters.`,
      };
    }
    return { value: values };
  }

  if (text.length > 300) {
    return {
      error: 'Please enter a meaningful answer with up to 300 characters.',
    };
  }
  return { value: text };
}
