import { ResumeVersionDetailResponse } from '@/services/api/resume';
import { readyStructuredResume } from './structuredResume';

export interface ExtractedResumeInfo {
  name: string;
  field: string;
  city: string;
  scoreDate: string;
  phone: string;
  email: string;
}

const MONTH_NAMES = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

export function extractCandidateResumeInfo(
  details: ResumeVersionDetailResponse | null | undefined,
  fallbackName?: string,
  fallbackCity?: string
): ExtractedResumeInfo {
  const structured = readyStructuredResume(details);
  let name =
    structured?.full_name?.trim() ||
    details?.parsed?.full_name?.trim() ||
    fallbackName?.trim() ||
    '';
  let field =
    structured?.education?.[0]?.field_of_study?.trim() ||
    structured?.education?.[0]?.qualification?.trim() ||
    '';
  let city = structured?.location?.trim() || fallbackCity?.trim() || '';
  let phone = structured?.contacts?.phone?.trim() || '';
  let email = structured?.contacts?.email?.trim() || '';
  let scoreDate = '';

  // 1. Format score date from confirmed_at or created_at
  const rawDate = details?.confirmed_at || details?.created_at;
  if (rawDate) {
    try {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        scoreDate = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
      }
    } catch {
      // Fallback below
    }
  }
  if (!scoreDate) {
    const now = new Date();
    scoreDate = `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
  }

  // 2. Extract from structured fields if present
  if (details?.parsed?.education && details.parsed.education.length > 0) {
    const primaryEdu = details.parsed.education[0];
    if (primaryEdu.qualification) {
      field = primaryEdu.qualification.trim();
    }
  }

  // 3. Extract from raw sections
  const sections = details?.sections || [];

  for (const section of sections) {
    const bodyLines = (section.body || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (section.kind === 'header') {
      bodyLines.forEach((line, index) => {
        // Name is almost always the first non-email, non-phone line
        if (index === 0 && !name && !line.includes('@') && !/\d{5,}/.test(line)) {
          name = line;
          return;
        }

        // Phone check
        const phoneMatch = line.match(/(?:\+?\d{1,3}[\s-]?)?\(?\d{2,5}\)?[\s-]?\d{3,5}[\s-]?\d{3,5}/);
        if (phoneMatch && !phone) {
          phone = phoneMatch[0].trim();
        }

        // Email check
        const emailMatch = line.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (emailMatch && !email) {
          email = emailMatch[0].trim();
        }

        // City check from pipe-delimited or comma-separated tokens
        if (!city) {
          const parts = line.split(/[|•]/);
          for (const part of parts) {
            const trimmed = part.trim();
            if (
              !trimmed.includes('@') &&
              !/\d{5,}/.test(trimmed) &&
              (/,\s*[A-Za-z\s]+$/.test(trimmed) ||
                /India|Maharashtra|Karnataka|Delhi|Kanpur|Mumbai|Pune|Bangalore|Bengaluru|Noida|Gurugram|Chennai|Hyderabad|Kolkata/i.test(
                  trimmed
                ))
            ) {
              // Extract the city name
              city = trimmed.split(',')[0].trim();
              break;
            }
          }
        }
      });
    } else if (section.kind === 'education' && !field) {
      // Find degree line
      for (const line of bodyLines) {
        const clean = line.replace(/^[•●▪■◦‣►➢✓*–-]\s*/, '').trim();

        // Check if line contains a degree keyword
        if (
          /B\.?Tech|M\.?Tech|B\.?Sc|M\.?Sc|BCA|MCA|B\.?E\.?|M\.?E\.?|B\.?Com|M\.?Com|BBA|MBA|Bachelor|Master|Diploma|Associate|HSC|SSC|Engineering/i.test(
            clean
          )
        ) {
          // Strip dates and percentages from the end (e.g. "Oct. 2023 - June 2027" or "2022–2025 · 68%")
          let degree = clean
            .replace(
              /\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*\d{4}.*$/i,
              ''
            )
            .replace(/\s*\d{4}\s*[-–-]\s*(?:\d{4}|Present).*$/i, '')
            .replace(/\s*·\s*.*$/, '')
            .replace(/\s*[({\[]\s*$/, '')
            .replace(/[,·•|-]\s*$/, '')
            .trim();

          if (degree) {
            field = degree;
            break;
          }
        }
      }

      // If no degree keyword matched, use the first line of education
      if (!field && bodyLines.length > 0) {
        field = bodyLines[0].replace(/^[•●▪■◦‣►➢✓*–-]\s*/, '').split(/·|-|–/)[0].trim();
      }
    }
  }

  // 4. Fallback for field if headline is available
  if (!field && details?.parsed?.headline) {
    field = details.parsed.headline.trim();
  }

  return {
    name,
    field,
    city,
    scoreDate,
    phone,
    email,
  };
}
