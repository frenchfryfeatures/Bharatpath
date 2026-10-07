import { apiRequest } from './client';
import { Platform } from 'react-native';
import { File as ExpoFile } from 'expo-file-system';
import type { UploadedFileMeta } from '@/screens/onboarding/ResumeIntakeScreen';

export type CareerDetails = Record<string, string | number | string[] | null>;
export interface ResumeDraft {
  full_name: string;
  email: string;
  details: CareerDetails;
}

/**
 * Apply non-empty facts read from a resume without erasing useful fields when
 * the parser could not find a value. This mirrors the web career form.
 */
export function mergeResumeDetails(
  current: CareerDetails,
  parsed: CareerDetails,
): CareerDetails {
  return {
    ...current,
    ...Object.fromEntries(
      Object.entries(parsed).filter(
        ([, value]) =>
          value !== '' &&
          value !== null &&
          value !== undefined &&
          (!Array.isArray(value) || value.length > 0),
      ),
    ),
  };
}
async function resumeBody(file: UploadedFileMeta) {
  if (!file.fileUri) throw new Error('Select a resume file.');
  const body = new FormData();
  if (Platform.OS === 'web')
    body.append(
      'file',
      await (await fetch(file.fileUri)).blob(),
      file.fileName,
    );
  else {
    // Expo SDK 54's native fetch path can read File objects directly. Sending
    // the old `{ uri, name, type }` descriptor can produce a multipart part
    // without the selected document bytes on newer Android runtimes, leaving
    // the preview API with nothing useful to extract.
    const selectedFile = new ExpoFile(file.fileUri);
    if (!selectedFile.exists) throw new Error('The selected resume is no longer available.');
    body.append('file', selectedFile, file.fileName || 'resume.pdf');
  }
  return body;
}
export const previewSignupResume = async (file: UploadedFileMeta) =>
  apiRequest<ResumeDraft>('/auth/resume-preview', {
    method: 'POST',
    body: await resumeBody(file),
  });
export const intakeCareerResume = async (file: UploadedFileMeta) =>
  apiRequest<{ resume_version_id: string }>('/candidate/resume/intake', {
    method: 'POST',
    body: await resumeBody(file),
  });
export interface CareerField {
  key: string;
  label: string;
  type: 'text' | 'tel' | 'number' | 'month' | 'list' | 'select';
  required: boolean;
  section: 'basic' | 'employment' | 'education' | 'preferences';
  options: { value: string; label: string }[];
}
export interface CareerProfile {
  details: CareerDetails;
  resume_version_id: string | null;
  resume_file_id: string | null;
  resume_filename: string | null;
  completed: boolean;
  updated_at: string | null;
}
export const getCareerFields = () =>
  apiRequest<CareerField[]>('/candidate/profile/form');
export const getCareerProfile = () =>
  apiRequest<CareerProfile>('/candidate/profile/details');
export const prefillCareerProfile = (id: string) =>
  apiRequest<CareerProfile>(`/candidate/profile/prefill/${id}`, {
    method: 'POST',
  });
/**
 * Normalise and sanitize a city name to conform to backend validation:
 * - Letters, combining marks, spaces and `. ' -` only.
 * - Max 100 characters, at least one letter.
 * - Extracts the city part when strings like "Kanpur, India" or "Gurugram, Haryana" are provided.
 * - Returns "" if the string cannot be cleaned into a valid city.
 */
export function sanitizeCity(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // Split on common city/state/country delimiters (comma, slash, pipe, semicolon, paren)
  const firstPart = raw.split(/[,/|;(]/)[0] ?? '';
  // Keep only Unicode letters, Unicode combining marks, whitespace, and . ' -
  const cleaned = firstPart.replace(/[^\p{L}\p{M}\s.'-]/gu, '');
  // Collapse whitespace
  const normalized = cleaned.replace(/\s+/g, ' ').trim();
  // Strip leading and trailing punctuation (dots, hyphens, quotes, spaces)
  const trimmed = normalized.replace(/^[\s.'-]+|[\s.'-]+$/gu, '').trim();
  if (!trimmed || trimmed.length > 100) return '';
  // Must contain at least one letter
  if (!/\p{L}/u.test(trimmed)) return '';
  // Must strictly only contain allowed characters
  if (!/^[\p{L}\p{M}\s.'-]+$/u.test(trimmed)) return '';
  return trimmed;
}

export function cleanCareerDetailsForApi(raw: CareerDetails): CareerDetails {
  const details = { ...raw };
  const cleaned: Record<string, any> = {};

  // 1. Phone: must match international format if present, else empty string
  const phoneStr = typeof details.phone === 'string' ? details.phone.trim() : '';
  cleaned.phone = /^\+[1-9]\d{7,14}$/.test(phoneStr) ? phoneStr : '';

  // 2. Work status
  const ws = String(details.work_status || '').toUpperCase();
  cleaned.work_status = ws === 'FRESHER' || ws === 'EXPERIENCED' ? ws : '';

  // 3. Currently employed
  const ce = String(details.currently_employed || '').toUpperCase();
  cleaned.currently_employed = ce === 'YES' || ce === 'NO' ? ce : '';

  // 4. Experience duration
  if (cleaned.work_status === 'FRESHER') {
    cleaned.experience_years = 0;
    cleaned.experience_months = 0;
    cleaned.currently_employed = 'NO';
  } else {
    const yrs = Math.floor(Number(details.experience_years) || 0);
    const mos = Math.floor(Number(details.experience_months) || 0);
    cleaned.experience_years = Math.max(0, Math.min(60, yrs));
    cleaned.experience_months = Math.max(0, Math.min(11, mos));
  }

  // 5. Employment dates
  const ymRegex = /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/;
  const startStr = typeof details.employment_start === 'string' ? details.employment_start.trim() : '';
  const endStr = typeof details.employment_end === 'string' ? details.employment_end.trim() : '';
  cleaned.employment_start = ymRegex.test(startStr) ? startStr : '';
  cleaned.employment_end = ymRegex.test(endStr) ? endStr : '';

  if (cleaned.currently_employed === 'YES') {
    cleaned.employment_end = '';
  } else if (cleaned.currently_employed === 'NO') {
    cleaned.company_name = '';
    cleaned.job_title = '';
    cleaned.employment_start = '';
    cleaned.employment_end = '';
    cleaned.annual_salary = null;
    cleaned.notice_period = '';
    cleaned.job_role = '';
  }

  if (cleaned.employment_start && cleaned.employment_end && cleaned.employment_end < cleaned.employment_start) {
    cleaned.employment_end = '';
  }

  // 6. Education years
  const startYearNum = Number(details.starting_year);
  cleaned.starting_year =
    Number.isInteger(startYearNum) && startYearNum >= 1950 && startYearNum <= 2100
      ? startYearNum
      : null;

  const passingYearNum = Number(details.passing_year);
  cleaned.passing_year =
    Number.isInteger(passingYearNum) && passingYearNum >= 1950 && passingYearNum <= 2100
      ? passingYearNum
      : null;

  if (cleaned.starting_year && cleaned.passing_year && cleaned.passing_year < cleaned.starting_year) {
    cleaned.passing_year = null;
  }

  // 7. Salaries
  const annualSalaryNum = Number(details.annual_salary);
  cleaned.annual_salary =
    Number.isInteger(annualSalaryNum) && annualSalaryNum >= 0 && annualSalaryNum <= 1_000_000_000
      ? annualSalaryNum
      : null;

  const prefSalaryNum = Number(details.preferred_salary);
  cleaned.preferred_salary =
    Number.isInteger(prefSalaryNum) && prefSalaryNum >= 0 && prefSalaryNum <= 1_000_000_000
      ? prefSalaryNum
      : null;

  // 8. Notice period
  const np = String(details.notice_period || '');
  const validNp = [
    '',
    'IMMEDIATE',
    '15_DAYS',
    '30_DAYS',
    '60_DAYS',
    '90_DAYS',
    'MORE_THAN_90_DAYS',
    'NOT_WORKING',
  ];
  cleaned.notice_period = validNp.includes(np) ? np : '';

  // 9. Course type
  const ct = String(details.course_type || '');
  const validCt = ['', 'FULL_TIME', 'PART_TIME', 'DISTANCE', 'ONLINE'];
  cleaned.course_type = validCt.includes(ct) ? ct : '';

  // 10. Gender
  const g = String(details.gender || '');
  const validG = ['', 'FEMALE', 'MALE', 'NON_BINARY', 'SELF_DESCRIBE', 'PREFER_NOT_TO_SAY'];
  cleaned.gender = validG.includes(g) ? g : '';

  // 11. Key skills (max 100, each 1-80 chars)
  const skillsList = Array.isArray(details.key_skills) ? details.key_skills : [];
  cleaned.key_skills = skillsList
    .map((s) => (typeof s === 'string' ? s.trim().slice(0, 80) : ''))
    .filter((s) => s.length > 0)
    .slice(0, 100);

  // 12. Preferred locations (max 5, each 1-100 chars)
  const locsList = Array.isArray(details.preferred_locations) ? details.preferred_locations : [];
  cleaned.preferred_locations = locsList
    .map((l) => (typeof l === 'string' ? l.trim().slice(0, 100) : ''))
    .filter((l) => l.length > 0)
    .slice(0, 5);

  // 13. Current city: must strictly follow backend city rules (letters, spaces, . ' -)
  cleaned.current_city = sanitizeCity(details.current_city);

  // 14. Text fields (max 300 chars)
  const textFields = [
    'company_name',
    'job_title',
    'industry',
    'department',
    'role_category',
    'job_role',
    'highest_qualification',
    'course',
    'specialization',
    'specialization_name',
    'institution',
    'headline',
  ];
  for (const field of textFields) {
    if (cleaned[field] === undefined) {
      const val = details[field];
      cleaned[field] = typeof val === 'string' ? val.trim().slice(0, 300) : '';
    }
  }

  return cleaned as CareerDetails;
}

export const saveCareerProfile = (
  details: CareerDetails,
  resume_version_id: string | null,
  complete: boolean,
  resume_filename?: string,
) => {
  const cleanedDetails = cleanCareerDetailsForApi(details);
  const validUuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const versionId =
    resume_version_id && validUuidRegex.test(resume_version_id)
      ? resume_version_id
      : null;

  return apiRequest<CareerProfile>('/candidate/profile/details', {
    method: 'PUT',
    body: {
      details: cleanedDetails,
      resume_version_id: versionId,
      complete,
      resume_filename: resume_filename
        ? String(resume_filename).slice(0, 255)
        : null,
    },
  });
};
export const getResumePreview = (id: string) =>
  apiRequest<{ pages: string[]; text: string; truncated: boolean }>(
    `/candidate/resume/versions/${id}/preview`,
  );

const inactiveEmploymentFields = [
  'company_name',
  'job_title',
  'employment_start',
  'employment_end',
  'annual_salary',
  'notice_period',
  'job_role',
];

export function careerDetailsForSave(details: CareerDetails): CareerDetails {
  const result = { ...details };
  delete result.key_skills;
  if (details.currently_employed === 'NO') {
    for (const key of inactiveEmploymentFields) delete result[key];
  } else if (details.currently_employed === 'YES') {
    delete result.employment_end;
  }
  return result;
}

export function fieldRequired(field: CareerField, details: CareerDetails) {
  if (field.key === 'key_skills') return false;
  if (field.required) return true;
  if (details.work_status !== 'EXPERIENCED') return false;
  if (field.key === 'currently_employed') return true;
  return (
    details.currently_employed === 'YES' &&
    ['company_name', 'job_title', 'employment_start'].includes(field.key)
  );
}
export function fieldVisible(field: CareerField, details: CareerDetails) {
  if (field.key === 'employment_end' || field.key === 'key_skills') return false;
  const work = [
    'currently_employed',
    'experience_years',
    'experience_months',
    'company_name',
    'job_title',
    'employment_start',
    'employment_end',
    'annual_salary',
    'notice_period',
    'industry',
    'department',
    'role_category',
    'job_role',
  ];
  return (
    !(details.work_status === 'FRESHER' && work.includes(field.key)) &&
    !(
      details.currently_employed === 'NO' &&
      inactiveEmploymentFields.includes(field.key)
    )
  );
}
