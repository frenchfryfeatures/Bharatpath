/**
 * BharatPath - Profile Photo Service
 *
 * Integrates with Backend /api/v1/profile/photo endpoints:
 *   - GET /profile/photo         (Fetch current signed photo URL or nulls)
 *   - POST /profile/photo/upload  (Issue presigned S3 PUT ticket)
 *   - Direct PUT bytes to S3      (Direct binary storage upload)
 *   - POST /profile/photo/confirm (Verify, strip EXIF, scale to 512px, activate)
 *   - DELETE /profile/photo       (Remove photo from account)
 *
 * Single source of truth across both Web and Mobile apps:
 * - A student uploading on Web sees the photo on Mobile.
 * - A student uploading on Mobile sees the photo on Web.
 * - Photos are strictly private to the candidate & staff; never sent to employers/colleges.
 */
import { Platform } from 'react-native';
import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy';
import { apiRequest, ApiError, getBaseUrl } from './client';

export interface ProfilePhotoResponse {
  url: string | null;
  mime: string | null;
  width: number | null;
  height: number | null;
  updated_at: string | null;
  expires_in_seconds: number | null;
}

export interface PhotoUploadTicket {
  upload_id: string;
  url: string;
  expires_in_seconds: number;
  max_bytes: number;
  accepted_types: string[];
}

/**
 * Rewrites localhost or LocalStack 4566 URLs to the host device's LAN IP
 * when running native on a physical phone or simulator so direct S3 PUTs connect.
 */
export function reachableStorageUrl(presignedUrl: string): string {
  if (Platform.OS === 'web') {
    return presignedUrl;
  }

  const backendHost = new URL(getBaseUrl()).hostname;
  const isLocalhostHost =
    backendHost === 'localhost' || backendHost === '127.0.0.1';

  try {
    const parsed = new URL(presignedUrl);
    if (
      !isLocalhostHost &&
      (parsed.port === '4566' ||
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1')
    ) {
      if (parsed.hostname !== backendHost) {
        parsed.hostname = backendHost;
        return parsed.toString();
      }
    }
  } catch {
    // Fall back to original URL
  }
  return presignedUrl;
}

/**
 * Fetch the current user's profile photo.
 * `GET /profile/photo`.
 * All fields are null if no photo has been set.
 */
export async function getProfilePhoto(): Promise<ProfilePhotoResponse> {
  return apiRequest<ProfilePhotoResponse>('/profile/photo');
}

/**
 * Request an upload ticket with a presigned S3 PUT URL.
 * `POST /profile/photo/upload`.
 */
export async function createProfilePhotoUpload(): Promise<PhotoUploadTicket> {
  return apiRequest<PhotoUploadTicket>('/profile/photo/upload', {
    method: 'POST',
  });
}

export class PhotoUploadError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`Photo storage upload failed with status ${status}: ${body}`);
    this.name = 'PhotoUploadError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Upload binary image bytes directly to the presigned S3 ticket URL.
 * S3 must never see our Authorization header.
 */
export async function uploadPhotoBinary(
  ticketUrl: string,
  fileUri: string,
  mimeType: string,
): Promise<void> {
  const targetUrl = reachableStorageUrl(ticketUrl);
  const contentType = mimeType || 'image/jpeg';

  if (Platform.OS !== 'web') {
    const result = await uploadAsync(targetUrl, fileUri, {
      httpMethod: 'PUT',
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': contentType },
    });
    if (result.status < 200 || result.status >= 300) {
      throw new PhotoUploadError(
        result.status,
        result.body || 'Failed to upload photo bytes to storage.',
      );
    }
    return;
  }

  // Web fallback using fetch
  const localFile = await fetch(fileUri);
  if (!localFile.ok) {
    throw new Error('Could not read the selected image file.');
  }
  const blob = await localFile.blob();

  const response = await fetch(targetUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: blob,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new PhotoUploadError(response.status, text || 'Photo storage upload failed.');
  }
}

/**
 * Complete the upload by confirming with the backend.
 * `POST /profile/photo/confirm`.
 * The backend verifies size & type, strips EXIF metadata, and rescales to 512px.
 */
export async function confirmProfilePhoto(
  uploadId: string,
): Promise<ProfilePhotoResponse> {
  return apiRequest<ProfilePhotoResponse>('/profile/photo/confirm', {
    method: 'POST',
    body: { upload_id: uploadId },
  });
}

/**
 * Remove the current profile photo.
 * `DELETE /profile/photo`.
 * Returns ImageResponse with null fields.
 */
export async function deleteProfilePhoto(): Promise<ProfilePhotoResponse> {
  return apiRequest<ProfilePhotoResponse>('/profile/photo', {
    method: 'DELETE',
  });
}
