/**
 * BharatPath - Privacy & Data Rights API Service
 * 
 * Handles data export and account deletion requests according to DSR standards:
 * - GET /privacy/requests
 * - POST /privacy/requests/export
 * - POST /privacy/requests/deletion
 * - POST /privacy/requests/:id/withdraw
 * - GET /privacy/requests/:id/download
 */

import { apiRequest } from './client';

export interface PrivacyRequest {
  id: string;
  type: 'EXPORT' | 'DELETE';
  state: 'RECEIVED' | 'PROCESSING' | 'COMPLETED' | 'REJECTED';
  created_at: string;
  due_at: string;
  completed_at: string | null;
  erasable_at: string | null;
  download_available: boolean;
}

export interface PrivacyRequestsResponse {
  items: PrivacyRequest[];
}

export interface DownloadUrlResponse {
  url: string;
  expires_in_seconds: number;
}

export async function fetchPrivacyRequests(): Promise<PrivacyRequest[]> {
  try {
    const data = await apiRequest<PrivacyRequestsResponse>('/privacy/requests');
    return data?.items || [];
  } catch (err: any) {
    console.warn('[Privacy API] fetchPrivacyRequests failed:', err?.message);
    // Return empty list on network/api error so UI remains functional
    return [];
  }
}

export async function requestPrivacyExport(): Promise<PrivacyRequest> {
  return await apiRequest<PrivacyRequest>('/privacy/requests/export', {
    method: 'POST',
  });
}

export async function requestPrivacyDeletion(): Promise<PrivacyRequest> {
  return await apiRequest<PrivacyRequest>('/privacy/requests/deletion', {
    method: 'POST',
  });
}

export async function withdrawPrivacyRequest(id: string): Promise<PrivacyRequest> {
  return await apiRequest<PrivacyRequest>(`/privacy/requests/${id}/withdraw`, {
    method: 'POST',
  });
}

export async function getPrivacyDownload(id: string): Promise<DownloadUrlResponse> {
  return await apiRequest<DownloadUrlResponse>(`/privacy/requests/${id}/download`, {
    method: 'GET',
  });
}
