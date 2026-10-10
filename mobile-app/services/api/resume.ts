/**
 * BharatPath - Resume Service
 * Integrates with Backend /api/v1/candidate/resume/* endpoints:
 * - Uploads (presigned URL PUT + complete + polling)
 * - Paste Text (POST /candidate/resume/text)
 * - Manual Entry (POST /candidate/resume/manual)
 * - Versions Review (GET /candidate/resume/versions/{id})
 * - Version Confirm Gate (POST /candidate/resume/versions/{id}/confirm)
 */
import { Platform } from 'react-native';
import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy';
import { apiRequest, getBaseUrl } from './client';
import { ManualResumeData } from '@/screens/onboarding/ManualResumeModal';

export interface UploadTicketResponse {
  upload_id: string;
  url: string;
  method: string;
  expires_in_seconds: number;
  max_bytes: number;
  accepted_types: string[];
}

export interface UploadCompleteResponse {
  resume_file_id: string;
  scan_status: 'PENDING' | 'CLEAN' | 'INFECTED' | 'FAILED';
  parse_status: 'QUEUED' | 'DONE' | 'FAILED' | 'BLOCKED';
}

export interface ResumeFileStatusResponse {
  resume_file_id: string;
  scan_status: string;
  parse_status: 'QUEUED' | 'DONE' | 'FAILED' | 'BLOCKED';
  parse_error_code: string | null;
  terminal: boolean;
  uploaded_at: string;
  resume_version_id: string | null;
}

export interface ResumeVersionResponse {
  resume_version_id: string;
  source: 'UPLOAD' | 'PASTE' | 'MANUAL' | 'EDIT';
  confirmed: boolean;
  created_at: string;
}

export type SectionKind =
  | 'header'
  | 'summary'
  | 'experience'
  | 'projects'
  | 'education'
  | 'skills'
  | 'certifications'
  | 'languages'
  | 'achievements'
  | 'activities'
  | 'personal';

export interface ResumeSectionItem {
  text: string;
  unclear: boolean;
  suggestion?: string | null;
}

export interface ResumeSection {
  kind: SectionKind;
  heading?: string | null;
  body: string;
  items?: ResumeSectionItem[] | null;
}

export interface StructuredResumeContacts {
  email?: string | null;
  phone?: string | null;
  linkedin?: string | null;
  github?: string | null;
  behance?: string | null;
  website?: string | null;
  instagram?: string | null;
  tiktok?: string | null;
  pinterest?: string | null;
  x_twitter?: string | null;
  medium?: string | null;
  dev_to?: string | null;
  stack_overflow?: string | null;
  others?: { label: string; url: string }[] | null;
}

export interface StructuredResumeExperience {
  job_title?: string | null;
  company?: string | null;
  location?: string | null;
  employment_type?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean | null;
  description?: string | null;
  highlights?: string[] | null;
  skills_used?: string[] | null;
}

export interface StructuredResumeEducation {
  qualification?: string | null;
  field_of_study?: string | null;
  institution?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  grade?: string | null;
  description?: string | null;
}

export type StructuredResumeListItem =
  | string
  | Record<string, unknown>;

export interface ParsedStructuredResume {
  full_name?: string | null;
  headline?: string | null;
  location?: string | null;
  summary?: string | null;
  contacts?: StructuredResumeContacts | null;
  experience?: StructuredResumeExperience[] | null;
  education?: StructuredResumeEducation[] | null;
  skills?: string[] | null;
  projects?: StructuredResumeListItem[] | null;
  certifications?: StructuredResumeListItem[] | null;
  languages?: StructuredResumeListItem[] | null;
  achievements?: StructuredResumeListItem[] | null;
  interests?: StructuredResumeListItem[] | null;
  other_sections?: {
    heading: string;
    items: StructuredResumeListItem[];
  }[] | null;
}

export type StructuredResumeStatus = 'READY' | 'FAILED' | 'UNAVAILABLE';

export interface ResumeVersionDetailResponse {
  resume_version_id: string;
  source: 'UPLOAD' | 'PASTE' | 'MANUAL' | 'EDIT';
  parsed: {
    raw_text?: string;
    page_count?: number;
    full_name?: string;
    headline?: string;
    experience?: {
      employer: string;
      title: string;
      start_year: number;
      end_year?: number | null;
      summary?: string | null;
    }[];
    education?: {
      institution: string;
      qualification: string;
      completed_year?: number | null;
    }[];
    skills?: string[];
    extractor?: {
      parser: string;
      parser_version: string;
    };
    // Accepted temporarily for servers that nested the new fields in parsed.
    structured_resume?: ParsedStructuredResume | null;
    structured_status?: StructuredResumeStatus;
  };
  structured_resume?: ParsedStructuredResume | null;
  structured_status?: StructuredResumeStatus;
  sections?: ResumeSection[] | null;
  confirmed: boolean;
  confirmed_at: string | null;
  supersedes_id: string | null;
  superseded: boolean;
  created_at: string;
}

export interface ResumeConfirmResponse {
  resume_version_id: string;
  confirmed_at: string;
  already_confirmed: boolean;
}

export interface StructuredResumeData {
  full_name: string;
  headline?: string | null;
  experience: {
    employer: string;
    title: string;
    start_year: number;
    end_year?: number | null;
    summary?: string | null;
  }[];
  education: {
    institution: string;
    qualification: string;
    completed_year?: number | null;
  }[];
  skills: string[];
}

export interface ResumeSectionEdit {
  kind: SectionKind;
  heading?: string | null;
  body: string;
}

export type ResumeEditRequest =
  | { text: string; structured?: never; sections?: never }
  | { text?: never; structured: StructuredResumeData; sections?: never }
  | { text?: never; structured?: never; sections: ResumeSectionEdit[] };

export interface ResumeVersionSummary {
  resume_version_id: string;
  source: 'UPLOAD' | 'PASTE' | 'MANUAL' | 'EDIT';
  confirmed: boolean;
  confirmed_at: string | null;
  supersedes_id: string | null;
  superseded: boolean;
  created_at: string;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const textOrEmpty = (value: unknown): string =>
  typeof value === 'string' ? value : '';

/** Keep incomplete parser output renderable without trusting its JSON shape. */
export function normalizeResumeVersionDetails(value: unknown): ResumeVersionDetailResponse {
  const detail = record(value);
  if (!detail || typeof detail.resume_version_id !== 'string' || !detail.resume_version_id) {
    throw new Error('The server returned incomplete resume details. Please try again.');
  }
  const parsed = record(detail.parsed) ?? {};
  const sections = Array.isArray(detail.sections)
    ? detail.sections.flatMap((entry): ResumeSection[] => {
        const section = record(entry);
        if (!section || typeof section.kind !== 'string') return [];
        return [{
          kind: section.kind as SectionKind,
          heading: typeof section.heading === 'string' ? section.heading : null,
          body: textOrEmpty(section.body),
          items: Array.isArray(section.items)
            ? section.items.flatMap((item): ResumeSectionItem[] => {
                const data = record(item);
                return data && typeof data.text === 'string'
                  ? [{ text: data.text, unclear: data.unclear === true,
                      suggestion: typeof data.suggestion === 'string' ? data.suggestion : null }]
                  : [];
              })
            : null,
        }];
      })
    : null;
  return {
    ...detail,
    resume_version_id: detail.resume_version_id,
    parsed: {
      ...parsed,
      raw_text: textOrEmpty(parsed.raw_text),
      full_name: textOrEmpty(parsed.full_name),
      headline: textOrEmpty(parsed.headline),
      experience: Array.isArray(parsed.experience) ? parsed.experience.filter(record) : [],
      education: Array.isArray(parsed.education) ? parsed.education.filter(record) : [],
      skills: Array.isArray(parsed.skills) ? parsed.skills.filter((v): v is string => typeof v === 'string') : [],
    },
    sections,
    confirmed: detail.confirmed === true,
    superseded: detail.superseded === true,
  } as ResumeVersionDetailResponse;
}

/**
 * 1. Issue a presigned PUT URL for uploading a CV document
 */
export async function createUploadTicket(): Promise<UploadTicketResponse> {
  return await apiRequest<UploadTicketResponse>('/candidate/resume/uploads', {
    method: 'POST',
  });
}

/**
 * A refusal from object storage, carrying what the store actually said. The
 * body is XML with a machine-readable `<Code>`, which is the difference
 * between "try again" and "the bucket does not exist".
 */
export class UploadTransferError extends Error {
  status: number;
  storageCode: string | null;

  constructor(status: number, body: string) {
    const storageCode = /<Code>([^<]+)<\/Code>/.exec(body)?.[1] ?? null;
    super(
      storageCode
        ? `Storage refused the upload (${status} ${storageCode}).`
        : `Storage refused the upload (HTTP ${status}).`,
    );
    this.name = 'UploadTransferError';
    this.status = status;
    this.storageCode = storageCode;
  }
}

/**
 * The host a presigned URL must be rewritten to so a phone or emulator can
 * actually reach it.
 *
 * The backend now signs presigned URLs against `AWS_ENDPOINT_URL_EXTERNAL`
 * (the Mac's LAN IP in dev), so the URL's host is already one the device can
 * reach and no rewrite is needed. This function remains as a safety net for
 * the case where that setting is unset and the URL still names `localhost`:
 * on a phone or emulator `localhost` is the device itself, not the Mac, so
 * the upload would silently fail to connect.
 *
 * The port is preserved: LocalStack listens on 4566, not on the API's 8099.
 */
function reachableFromThisDevice(presignedUrl: string): string {
  // Web runs in the browser on the host machine, so `localhost` is correct.
  if (Platform.OS === 'web') {
    return presignedUrl;
  }

  const backendHost = new URL(getBaseUrl()).hostname;
  const isLocalhostHost =
    backendHost === 'localhost' || backendHost === '127.0.0.1';

  try {
    const parsed = new URL(presignedUrl);
    // If it's a LocalStack port (4566) or localhost, and backend is reached via LAN IP:
    // ensure the device connects to backendHost on port 4566
    if (!isLocalhostHost && (parsed.port === '4566' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
      if (parsed.hostname !== backendHost) {
        parsed.hostname = backendHost;
        return parsed.toString();
      }
    }
  } catch {
    // Fall through to presignedUrl
  }
  return presignedUrl;
}

/**
 * 2. Upload file bytes directly to the presigned S3/Localstack URL
 */
export async function uploadFileToPresignedUrl(
  presignedUrl: string,
  fileUri: string,
  mimeType: string,
): Promise<boolean> {
  const targetUrl = reachableFromThisDevice(presignedUrl);
  const contentType = mimeType || 'application/pdf';

  // On a device the picked file is a `file://` or `content://` URI, which
  // `fetch` cannot read; the native uploader streams it instead.
  if (Platform.OS !== 'web') {
    const result = await uploadAsync(targetUrl, fileUri, {
      httpMethod: 'PUT',
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': contentType },
    });
    if (result.status < 200 || result.status >= 300) {
      throw new UploadTransferError(result.status, result.body ?? '');
    }
    return true;
  }

  const localFileResponse = await fetch(fileUri);
  if (!localFileResponse.ok) {
    throw new Error('Could not read the selected resume file.');
  }

  const uploadResponse = await fetch(targetUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: await localFileResponse.blob(),
  });

  if (!uploadResponse.ok) {
    throw new UploadTransferError(
      uploadResponse.status,
      await uploadResponse.text(),
    );
  }
  return true;
}

/**
 * 3. Complete an upload to trigger validation and parsing (202 Accepted)
 */
export async function completeUpload(
  uploadId: string,
): Promise<UploadCompleteResponse> {
  return await apiRequest<UploadCompleteResponse>(
    `/candidate/resume/uploads/${uploadId}/complete`,
    {
      method: 'POST',
    },
  );
}

/**
 * 4. Poll upload scan and parse state
 */
export async function getFileStatus(
  fileId: string,
): Promise<ResumeFileStatusResponse> {
  return await apiRequest<ResumeFileStatusResponse>(
    `/candidate/resume/files/${fileId}`,
  );
}

/**
 * 5. Submit a CV as pasted text (min 50 chars)
 */
export async function submitPastedText(
  text: string,
): Promise<ResumeVersionResponse> {
  return await apiRequest<ResumeVersionResponse>('/candidate/resume/text', {
    method: 'POST',
    body: {
      text: text.trim(),
    },
  });
}

/**
 * 6. Submit a CV through structured manual form
 */
export async function submitManualResume(
  data: ManualResumeData,
): Promise<ResumeVersionResponse> {
  return await apiRequest<ResumeVersionResponse>('/candidate/resume/manual', {
    method: 'POST',
    body: {
      full_name: data.full_name.trim(),
      headline: data.headline?.trim() || null,
      experience: data.experience || [],
      education: data.education || [],
      skills: data.skills || [],
    },
  });
}

/**
 * 7. Review one version in full (returns parsed content)
 */
export async function getResumeVersionDetails(
  versionId: string,
): Promise<ResumeVersionDetailResponse> {
  const details = await apiRequest<unknown>(
    `/candidate/resume/versions/${versionId}`,
  );
  return normalizeResumeVersionDetails(details);
}

/**
 * 8. Correct a version. The backend creates a new unconfirmed version.
 */
export async function editResumeVersion(
  versionId: string,
  payload: ResumeEditRequest,
): Promise<ResumeVersionResponse> {
  return await apiRequest<ResumeVersionResponse>(
    `/candidate/resume/versions/${versionId}/edit`,
    {
      method: 'POST',
      body: payload,
    },
  );
}

/**
 * 9. Mandatory Confirm Gate (SRS 1.4.4): Confirms a version for scoring
 */
export async function confirmResumeVersion(
  versionId: string,
): Promise<ResumeConfirmResponse> {
  return await apiRequest<ResumeConfirmResponse>(
    `/candidate/resume/versions/${versionId}/confirm`,
    {
      method: 'POST',
    },
  );
}

/**
 * 10. List all resume versions for the authenticated candidate
 */
export async function listResumeVersions(): Promise<ResumeVersionSummary[]> {
  const versions = await apiRequest<unknown>('/candidate/resume/versions');
  if (!Array.isArray(versions)) throw new Error('The server returned an invalid resume list. Please try again.');
  return versions.filter((version): version is ResumeVersionSummary =>
    !!record(version) && typeof version.resume_version_id === 'string' && !!version.resume_version_id);
}
