import type {
  ParsedStructuredResume,
  ResumeSection,
  ResumeVersionDetailResponse,
  StructuredResumeListItem,
} from '@/services/api/resume';
import type { CareerDetails } from '@/services/api/career';

const present = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const label = (key: string) =>
  key
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

function itemText(item: StructuredResumeListItem): string {
  if (typeof item === 'string') return item.trim();
  return Object.entries(item)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => {
      const rendered = Array.isArray(value)
        ? value.filter(Boolean).join(', ')
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
      return `${label(key)}: ${rendered}`;
    })
    .join('\n');
}

const bodyForItems = (items: StructuredResumeListItem[] | null | undefined) =>
  (items ?? []).map(itemText).filter(Boolean).join('\n\n');

export function readyStructuredResume(
  details: ResumeVersionDetailResponse | null | undefined,
): ParsedStructuredResume | null {
  const status = details?.structured_status ?? details?.parsed?.structured_status;
  const structured =
    details?.structured_resume ?? details?.parsed?.structured_resume;
  return status === 'READY' && structured ? structured : null;
}

/** Turn the rich API payload into the review cards already used by mobile. */
export function structuredResumeSections(
  resume: ParsedStructuredResume,
): ResumeSection[] {
  const sections: ResumeSection[] = [];
  const contacts = resume.contacts;
  const contactLines = contacts
    ? [
        contacts.email,
        contacts.phone,
        contacts.linkedin,
        contacts.github,
        contacts.behance,
        contacts.website,
        contacts.instagram,
        contacts.tiktok,
        contacts.pinterest,
        contacts.x_twitter,
        contacts.medium,
        contacts.dev_to,
        contacts.stack_overflow,
        ...(contacts.others ?? []).map(({ label: name, url }) =>
          present(name) ? `${name}: ${url}` : url,
        ),
      ].filter(present)
    : [];
  const header = [
    resume.full_name,
    resume.headline,
    resume.location,
    ...contactLines,
  ].filter(present);
  if (header.length)
    sections.push({ kind: 'header', heading: null, body: header.join('\n') });

  if (present(resume.summary))
    sections.push({ kind: 'summary', heading: 'Summary', body: resume.summary });

  if (resume.experience?.length) {
    const body = resume.experience
      .map((experience) => {
        const companyLine = [
          experience.company,
          experience.location,
          experience.employment_type,
        ].filter(present).join(' · ');
        const dates = [
          experience.start_date,
          experience.is_current ? 'Present' : experience.end_date,
        ].filter(present).join(' – ');
        return [
          experience.job_title,
          companyLine,
          dates,
          experience.description,
          ...(experience.highlights ?? []).map((value) => `• ${value}`),
          experience.skills_used?.length
            ? `Skills: ${experience.skills_used.join(', ')}`
            : '',
        ].filter(present).join('\n');
      })
      .filter(Boolean)
      .join('\n\n');
    if (body) sections.push({ kind: 'experience', heading: 'Experience', body });
  }

  if (resume.education?.length) {
    const body = resume.education
      .map((education) => {
        const qualification = [education.qualification, education.field_of_study]
          .filter(present)
          .join(' — ');
        const institution = [education.institution, education.location]
          .filter(present)
          .join(' · ');
        const dates = [education.start_date, education.end_date]
          .filter(present)
          .join(' – ');
        return [
          qualification,
          institution,
          dates,
          present(education.grade) ? `Grade: ${education.grade}` : '',
          education.description,
        ].filter(present).join('\n');
      })
      .filter(Boolean)
      .join('\n\n');
    if (body) sections.push({ kind: 'education', heading: 'Education', body });
  }

  if (resume.skills?.length)
    sections.push({
      kind: 'skills',
      heading: 'Skills',
      body: resume.skills.join(', '),
      items: resume.skills.map((text) => ({ text, unclear: false })),
    });

  const groups: Array<{
    kind: ResumeSection['kind'];
    heading: string;
    items: StructuredResumeListItem[] | null | undefined;
  }> = [
    { kind: 'projects', heading: 'Projects', items: resume.projects },
    { kind: 'certifications', heading: 'Certifications', items: resume.certifications },
    { kind: 'languages', heading: 'Languages', items: resume.languages },
    { kind: 'achievements', heading: 'Achievements', items: resume.achievements },
    { kind: 'personal', heading: 'Interests', items: resume.interests },
  ];
  for (const group of groups) {
    const body = bodyForItems(group.items);
    if (body) sections.push({ kind: group.kind, heading: group.heading, body });
  }
  for (const other of resume.other_sections ?? []) {
    const body = bodyForItems(other.items);
    if (body) {
      const heading = other.heading || 'Other';
      const lower = heading.toLowerCase();
      let kind: ResumeSection['kind'] = 'activities';
      if (lower.includes('summary') || lower.includes('profile') || lower.includes('objective')) {
        kind = 'summary';
      } else if (lower.includes('skill') || lower.includes('technology') || lower.includes('technologies')) {
        kind = 'skills';
      } else if (lower.includes('project')) {
        kind = 'projects';
      } else if (lower.includes('certif') || lower.includes('license')) {
        kind = 'certifications';
      } else if (lower.includes('language')) {
        kind = 'languages';
      } else if (lower.includes('education') || lower.includes('academic')) {
        kind = 'education';
      } else if (lower.includes('experience') || lower.includes('employment') || lower.includes('work')) {
        kind = 'experience';
      } else if (lower.includes('achievement') || lower.includes('award') || lower.includes('honor')) {
        kind = 'achievements';
      }
      sections.push({
        kind,
        heading: heading || 'Other',
        body,
      });
    }
  }
  return sections;
}

const monthValue = (value: string | null | undefined): string => {
  if (!present(value)) return '';
  const match = value.match(/((?:19|20)\d{2})(?:-(0[1-9]|1[0-2]))?/);
  return match ? `${match[1]}-${match[2] || '01'}` : '';
};

const yearValue = (value: string | null | undefined): number | null => {
  if (!present(value)) return null;
  const match = value.match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : null;
};

function experienceDuration(
  experience: NonNullable<ParsedStructuredResume['experience']>,
) {
  let totalMonths = 0;
  for (const role of experience) {
    const start = monthValue(role.start_date);
    const end = role.is_current
      ? monthValue(new Date().toISOString().slice(0, 7))
      : monthValue(role.end_date);
    if (!start || !end) continue;
    const [startYear, startMonth] = start.split('-').map(Number);
    const [endYear, endMonth] = end.split('-').map(Number);
    totalMonths += Math.max(
      0,
      (endYear - startYear) * 12 + endMonth - startMonth,
    );
  }
  return {
    experience_years: Math.floor(totalMonths / 12),
    experience_months: totalMonths % 12,
  };
}

export function sanitizeCity(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const firstPart = raw.split(/[,/|;(]/)[0] ?? '';
  const cleaned = firstPart.replace(/[^\p{L}\p{M}\s.'-]/gu, '');
  const normalized = cleaned.replace(/\s+/g, ' ').trim();
  const trimmed = normalized.replace(/^[\s.'-]+|[\s.'-]+$/gu, '').trim();
  if (!trimmed || trimmed.length > 100) return '';
  if (!/\p{L}/u.test(trimmed)) return '';
  if (!/^[\p{L}\p{M}\s.'-]+$/u.test(trimmed)) return '';
  return trimmed;
}

/** Map a READY structured resume directly into the server-driven career form. */
export function structuredResumeCareerDetails(
  resume: ParsedStructuredResume,
  current: CareerDetails,
): CareerDetails {
  const latestRole = resume.experience?.[0];
  const education = resume.education?.[0];
  const parsed: CareerDetails = {
    phone:
      resume.contacts?.phone && /^\+[1-9]\d{7,14}$/.test(resume.contacts.phone)
        ? resume.contacts.phone
        : '',
    current_city: sanitizeCity(
      latestRole?.location || education?.location || resume.location || '',
    ),
    headline: resume.headline || resume.summary || '',
    key_skills: resume.skills ?? [],
    work_status: latestRole ? 'EXPERIENCED' : '',
    currently_employed: latestRole
      ? latestRole.is_current
        ? 'YES'
        : 'NO'
      : '',
    company_name: latestRole?.company || '',
    job_title: latestRole?.job_title || '',
    employment_start: monthValue(latestRole?.start_date),
    employment_end: latestRole?.is_current
      ? ''
      : monthValue(latestRole?.end_date),
    highest_qualification: education?.qualification || '',
    course: education?.qualification || '',
    specialization_name: education?.field_of_study || '',
    institution: education?.institution || '',
    starting_year: yearValue(education?.start_date),
    passing_year: yearValue(education?.end_date),
    ...(resume.experience?.length
      ? experienceDuration(resume.experience)
      : {}),
  };
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
