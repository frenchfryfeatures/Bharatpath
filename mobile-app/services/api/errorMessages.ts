type ValidationIssue = { loc?: unknown[]; type?: string; msg?: string };

const labels: Record<string, string> = {
  phone: 'mobile number', current_city: 'current city', full_name: 'full name',
  company_name: 'company', job_title: 'job title', employment_start: 'employment start date',
  employment_end: 'employment end date', annual_salary: 'annual salary',
  preferred_salary: 'preferred salary', annual_salary_currency: 'salary currency',
  preferred_salary_currency: 'preferred salary currency', notice_period: 'notice period',
  email: 'email address', password: 'password', work_status: 'work status',
  experience_years: 'years of experience', experience_months: 'months of experience',
  institution: 'institution', starting_year: 'starting year', passing_year: 'graduation year',
  course: 'course', course_type: 'course type', highest_qualification: 'highest qualification',
};

export function validationErrorMessage(detail: unknown): string {
  const issues = Array.isArray(detail) ? detail as ValidationIssue[] : [];
  if (issues.some((issue) => issue?.type === 'extra_forbidden')) {
    return 'We couldn’t save these details because the service needs an update. Your entries are still here. Please try again later.';
  }
  const messages = issues.flatMap((issue) => {
    if (!issue || typeof issue !== 'object') return [];
    const field = issue.loc?.filter((part) => typeof part === 'string' && !['body', 'details'].includes(part)).pop();
    const label = typeof field === 'string' ? labels[field] : undefined;
    if (!label) return [];
    if (issue.type === 'missing' || issue.type === 'string_too_short') return [`Please enter your ${label}.`];
    if (issue.type === 'literal_error' || issue.type === 'enum') return [`Please choose a valid ${label}.`];
    if (issue.type === 'string_too_long') return [`Please shorten your ${label}.`];
    return [`Please check your ${label} and try again.`];
  });
  return [...new Set(messages)].slice(0, 2).join(' ') || 'Some details need attention. Please check your answers and try again.';
}

export function httpErrorMessage(status: number): string {
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return 'Your account does not have access to this action. Please contact support.';
  if (status === 404) return 'We couldn’t find what you requested. Please refresh and try again.';
  if (status === 413) return 'This file is too large. Please choose a smaller file.';
  if (status === 429) return 'You’ve made several attempts. Please wait a moment and try again.';
  if (status >= 500) return 'We couldn’t complete that right now. Please try again in a moment.';
  return 'We couldn’t save your changes. Please check your details and try again.';
}
