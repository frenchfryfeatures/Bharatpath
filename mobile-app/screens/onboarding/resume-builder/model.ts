import type { ResumeBuilderContent, ResumeTemplateKey } from '@/services/api/resumeBuilder';
export type BuilderDraft = {
  template_key: ResumeTemplateKey;
  content: ResumeBuilderContent;
};
export const steps = ['Personal Information', 'Experience', 'Education', 'Skills', 'Projects', 'More'] as const;
export type Row = Record<string, unknown>;
export type Field = {
  key: string;
  label: string;
  kind?: 'long' | 'list' | 'lines' | 'date' | 'boolean' | 'email' | 'phone' | 'url';
  required?: boolean;
};
export const sections: Record<string, {
  title: string;
  singular: string;
  fields: Field[];
}> = {
  contact_links: {
    title: 'Other links', singular: 'Link', fields: [{
      key: 'label', label: 'Link label', required: true
    }, {
      key: 'url', label: 'URL', kind: 'url', required: true
    }]
  },
  experience: {
    title: 'Experience', singular: 'Experience', fields: [
      {
        key: 'job_title', label: 'Job title', required: true
      }, {
        key: 'company', label: 'Company', required: true
      },
      { key: 'location', label: 'Location' }, { key: 'employment_type', label: 'Employment type' },
      {
        key: 'start_date', label: 'Start date', kind: 'date', required: true
      }, {
        key: 'is_current', label: 'I currently work here', kind: 'boolean'
      },
      {
        key: 'end_date', label: 'End date', kind: 'date', required: true
      }, {
        key: 'description', label: 'Description', kind: 'long'
      },
      {
        key: 'highlights', label: 'Highlights (one per line)', kind: 'lines'
      }, {
        key: 'skills_used', label: 'Skills used (comma separated)', kind: 'list'
      }
    ]
  },
  education: {
    title: 'Education', singular: 'Education', fields: [
      {
        key: 'qualification', label: 'Qualification', required: true
      }, { key: 'field_of_study', label: 'Field of study' },
      {
        key: 'institution', label: 'Institution', required: true
      }, { key: 'location', label: 'Location' },
      {
        key: 'start_date', label: 'Start year or month', kind: 'date', required: true
      }, {
        key: 'end_date', label: 'End or expected year', kind: 'date', required: true
      },
      { key: 'grade', label: 'Grade / percentage / CGPA' }, {
        key: 'description', label: 'Description', kind: 'long'
      }
    ]
  },
  projects: {
    title: 'Projects', singular: 'Project', fields: [
      {
        key: 'name', label: 'Project name', required: true
      }, { key: 'role', label: 'Your role' },
      {
        key: 'description', label: 'Description', kind: 'long', required: true
      }, {
        key: 'technologies', label: 'Technologies (comma separated)', kind: 'list'
      },
      {
        key: 'url', label: 'Project / GitHub URL', kind: 'url'
      }, {
        key: 'start_date', label: 'Start date', kind: 'date'
      }, {
        key: 'end_date', label: 'End date', kind: 'date'
      }
    ]
  },
  certifications: {
    title: 'Certifications', singular: 'Certification', fields: [
      {
        key: 'name', label: 'Certification name', required: true
      }, {
        key: 'issuer', label: 'Issuer', required: true
      },
      {
        key: 'issue_date', label: 'Issue date', kind: 'date', required: true
      }, {
        key: 'expiry_date', label: 'Expiry date', kind: 'date'
      },
      { key: 'credential_id', label: 'Credential ID' }, {
        key: 'url', label: 'Credential URL', kind: 'url'
      }
    ]
  },
  languages: {
    title: 'Languages', singular: 'Language', fields: [{
      key: 'name', label: 'Language', required: true
    }, {
      key: 'proficiency', label: 'Proficiency', required: true
    }]
  },
  other_sections: {
    title: 'Additional information', singular: 'Section', fields: [{
      key: 'heading', label: 'Section heading', required: true
    }, {
      key: 'items', label: 'Details (one per line)', kind: 'lines'
    }]
  },
};
export const contacts: Field[] = [
  {
    key: 'email', label: 'Email', kind: 'email'
  }, {
    key: 'phone', label: 'Phone number', kind: 'phone'
  },
  ...[['linkedin', 'LinkedIn'], ['github', 'GitHub'], ['website', 'Portfolio / website'], ['behance', 'Behance'], ['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['pinterest', 'Pinterest'], ['x_twitter', 'X / Twitter'], ['medium', 'Medium'], ['dev_to', 'DEV Community'], ['stack_overflow', 'Stack Overflow']].map(([key, label]) => ({
    key, label, kind: 'url' as const
  }))
];
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export function rowErrors(section: string, row: Row): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of sections[section].fields) {
    if (field.key === 'end_date' && section === 'experience' && row.is_current)
      continue;
    const value = text(row[field.key]);
    if (field.required && !value)
      errors[field.key] = `Enter ${field.label.toLowerCase()}.`;
    if (value && field.kind === 'date' && !/^(?:19|20)\d{2}(?:-(?:0[1-9]|1[0-2]))?$/.test(value))
      errors[field.key] = 'Use YYYY or YYYY-MM, for example 2024 or 2024-06.';
    if (typeof row[field.key] === 'string' && String(row[field.key]).length > (field.kind === 'long' ? 5000 : field.kind === 'url' ? 500 : 300))
      errors[field.key] = 'Please shorten this answer.';
  }
  if(section==='other_sections'&&(!Array.isArray(row.items)||!row.items.length))errors.items='Add at least one item.';
  const startKey = section === 'certifications' ? 'issue_date' : 'start_date';
  const endKey = section === 'certifications' ? 'expiry_date' : 'end_date';
  const start = text(row[startKey]), end = text(row[endKey]);
  if (!(section === 'experience' && row.is_current) && start && end && (end.slice(0, 4) < start.slice(0, 4) || (start.length === 7 && end.length === 7 && end < start)))
    errors[endKey] = 'The ending date must not be before the starting date.';
  return errors;
}
export function stepErrors(step: number, content: ResumeBuilderContent): string[] {
  if (step === 0) {
    const errors=text(content.full_name)?[]:['Enter your full name.'];
    if(content.contacts?.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content.contacts.email.trim()))errors.push('Enter a valid email address.');
    for(const link of content.contacts?.others||[])errors.push(...Object.values(rowErrors('contact_links',link)));
    return errors;
  }
  const keys = step === 1 ? ['experience'] : step === 2 ? ['education'] : step === 4 ? ['projects'] : step === 5 ? ['certifications', 'languages', 'other_sections'] : [];
  return keys.flatMap(key => ((content[key as keyof ResumeBuilderContent] || []) as Row[]).flatMap((row, index) => Object.values(rowErrors(key, row)).map(error => `${sections[key].singular} ${index + 1}: ${error}`)));
}
export function finalErrors(content: ResumeBuilderContent) {
  const errors = steps.flatMap((_, step) => stepErrors(step, content));
  if (!content.experience?.length && !content.education?.length && !content.skills?.length)
    errors.push('Add at least one experience entry, education entry or skill.');
  return errors;
}
