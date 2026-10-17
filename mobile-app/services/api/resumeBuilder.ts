/**
 * BharatPath - Resume Builder API Service
 * Integrates with Backend /api/v1/candidate/resume-builder/*
 * (Documented in docs/backend-guide/18-resume-builder-apis.md).
 *
 * Endpoints:
 * - GET /candidate/resume-builder/templates
 * - GET /candidate/resume-builder/draft
 * - PUT /candidate/resume-builder/draft
 * - POST /candidate/resume-builder/draft/reset
 * - POST /candidate/resume-builder/preview
 * - POST /candidate/resume-builder/download
 * - POST /candidate/resume-builder/push
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { apiRequest, getAccessToken, getBaseUrl, ApiError } from './client';
export type {
  StructuredResumeContacts,
  StructuredResumeExperience,
  StructuredResumeEducation,
} from './resume';
import type {
  StructuredResumeContacts,
  StructuredResumeExperience,
  StructuredResumeEducation,
} from './resume';

export type ResumeTemplateKey = 'classic' | 'modern' | 'sidebar' | 'minimal';

export interface ResumeTemplateInfo {
  key: ResumeTemplateKey;
  name: string;
  description: string;
  columns: number;
}

export interface ResumeTemplatesResponse {
  templates: ResumeTemplateInfo[];
  default: ResumeTemplateKey;
  version: string;
}

export interface StructuredResumeProject {
  name: string;
  role?: string | null;
  description?: string | null;
  technologies?: string[] | null;
  url?: string | null;
}

export interface StructuredResumeCertification {
  name: string;
  issuer?: string | null;
  issue_date?: string | null;
}

export interface StructuredResumeLanguage {
  name: string;
  proficiency?: string | null;
}

export interface StructuredResumeOtherSection {
  heading: string;
  items: string[];
}

export interface ResumeBuilderContent {
  full_name?: string | null;
  headline?: string | null;
  location?: string | null;
  summary?: string | null;
  contacts?: StructuredResumeContacts | null;
  experience?: StructuredResumeExperience[] | null;
  education?: StructuredResumeEducation[] | null;
  skills?: string[] | null;
  projects?: StructuredResumeProject[] | null;
  certifications?: StructuredResumeCertification[] | null;
  languages?: StructuredResumeLanguage[] | null;
  achievements?: string[] | null;
  interests?: string[] | null;
  other_sections?: StructuredResumeOtherSection[] | null;
}

export interface ResumeDraftResponse {
  template_key: ResumeTemplateKey;
  content: ResumeBuilderContent;
  saved: boolean;
  updated_at?: string | null;
  first_downloaded_at?: string | null;
  last_downloaded_at?: string | null;
  download_count: number;
  pushed_version_id?: string | null;
  pushed_at?: string | null;
  pushed_is_current: boolean;
}

export interface ResumePreviewResponse {
  pages: string[];
  mime: 'image/png' | 'image/svg+xml';
  page_count: number;
}

export interface ResumePushResponse {
  resume_version_id: string;
  resume_file_id: string | null;
  created: boolean;
  confirmed: boolean;
}

/**
 * List available templates for the resume builder.
 */
export async function getResumeTemplates(): Promise<ResumeTemplatesResponse> {
  return apiRequest<ResumeTemplatesResponse>('/candidate/resume-builder/templates');
}

/**
 * Fetch the current resume builder draft.
 * If saved === false, content is prefilled from CV / onboarding answers.
 */
export async function getResumeDraft(): Promise<ResumeDraftResponse> {
  return apiRequest<ResumeDraftResponse>('/candidate/resume-builder/draft');
}

/**
 * Save draft (autosave / manual save).
 */
export async function saveResumeDraft(
  templateKey: ResumeTemplateKey,
  content: ResumeBuilderContent,
): Promise<ResumeDraftResponse> {
  return apiRequest<ResumeDraftResponse>('/candidate/resume-builder/draft', {
    method: 'PUT',
    body: {
      template_key: templateKey,
      content,
    },
  });
}

/**
 * Reset draft back to onboarding & CV answers, retaining current template.
 */
export async function resetResumeDraft(): Promise<ResumeDraftResponse> {
  return apiRequest<ResumeDraftResponse>('/candidate/resume-builder/draft/reset', {
    method: 'POST',
  });
}

/**
 * Render draft preview without saving.
 * Rate-limited to 60/min; debounce client calls (~500ms).
 */
export async function previewResumeDraft(
  templateKey: ResumeTemplateKey,
  content: ResumeBuilderContent,
  format: 'png' | 'svg' = 'png',
): Promise<ResumePreviewResponse> {
  return apiRequest<ResumePreviewResponse>('/candidate/resume-builder/preview', {
    method: 'POST',
    body: {
      template_key: templateKey,
      content,
      format,
    },
  });
}

/**
 * Use the saved draft as candidate resume (creates an unconfirmed BUILDER version).
 */
export async function pushResumeDraft(): Promise<ResumePushResponse> {
  return apiRequest<ResumePushResponse>('/candidate/resume-builder/push', {
    method: 'POST',
  });
}

/**
 * Download the saved resume draft as a PDF file and open the system share sheet.
 * Saves the draft first if content is provided.
 */
export async function downloadAndShareResumePdf(
  candidateName?: string | null,
): Promise<{ uri: string }> {
  const token = getAccessToken();
  const baseUrl = getBaseUrl();
  const downloadUrl = `${baseUrl}/candidate/resume-builder/download`;

  const safeName = (candidateName || 'Candidate')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${safeName}_Resume.pdf`;

  const res = await fetch(downloadUrl, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error('Failed to download resume PDF.');
  }

  if (Platform.OS === 'web') {
    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(blobUrl);
    return { uri: blobUrl };
  }

  const arrayBuffer = await res.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);
  let binary = '';
  const len = uint8.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  const base64 =
    typeof btoa !== 'undefined'
      ? btoa(binary)
      : Buffer.from(binary, 'binary').toString('base64');

  const fileUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(fileUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const isAvailable = await Sharing.isAvailableAsync();
  if (isAvailable) {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Share or Save Your Resume',
      UTI: 'com.adobe.pdf',
    });
  }

  return { uri: fileUri };
}
