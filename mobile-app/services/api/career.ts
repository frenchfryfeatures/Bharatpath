import { apiRequest } from './client';
import { Platform } from 'react-native';
import type { UploadedFileMeta } from '@/screens/onboarding/ResumeIntakeScreen';

export type CareerDetails = Record<string, string | number | string[] | null>;
export interface ResumeDraft {
  full_name: string;
  email: string;
  details: CareerDetails;
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
  else
    body.append('file', {
      uri: file.fileUri,
      name: file.fileName,
      type: file.mimeType ?? 'application/pdf',
    } as unknown as Blob);
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
export const saveCareerProfile = (
  details: CareerDetails,
  resume_version_id: string | null,
  complete: boolean,
  resume_filename?: string,
) =>
  apiRequest<CareerProfile>('/candidate/profile/details', {
    method: 'PUT',
    body: { details, resume_version_id, complete, resume_filename },
  });
export const getResumePreview = (id: string) =>
  apiRequest<{ pages: string[]; text: string; truncated: boolean }>(
    `/candidate/resume/versions/${id}/preview`,
  );

export function fieldRequired(field: CareerField, details: CareerDetails) {
  return (
    field.required ||
    (details.work_status === 'EXPERIENCED' &&
      ([
        'currently_employed',
        'company_name',
        'job_title',
        'employment_start',
      ].includes(field.key) ||
        (field.key === 'employment_end' &&
          details.currently_employed === 'NO')))
  );
}
export function fieldVisible(field: CareerField, details: CareerDetails) {
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
    !(field.key === 'employment_end' && details.currently_employed === 'YES')
  );
}
