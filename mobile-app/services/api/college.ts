/**
 * BharatPath - College Service
 *
 * Candidate-facing endpoints for college linking, invitations, and consent.
 */
import { apiRequest } from './client';
import {
  CollegeConsentScope,
  CollegeLinkResponse,
  ConsentTermsResponse,
  CandidateInvitationResponse,
  RevokeConsentResponse,
  LinkedCollege,
} from '@/types/college';

/**
 * List the colleges the candidate has linked to.
 * `GET /candidate/colleges`. Not paywalled.
 */
export async function getStudentCollegeLinks(): Promise<CollegeLinkResponse[]> {
  return apiRequest<CollegeLinkResponse[]>('/candidate/colleges');
}

/**
 * Fetch the consent terms text for a given scope before linking or sharing by name.
 * `GET /candidate/colleges/consent-terms?scope=ROSTER|INDIVIDUAL`
 */
export async function getCollegeConsentTerms(
  scope: CollegeConsentScope = 'ROSTER',
): Promise<ConsentTermsResponse> {
  return apiRequest<ConsentTermsResponse>(
    `/candidate/colleges/consent-terms?scope=${encodeURIComponent(scope)}`,
  );
}

/**
 * Link to a college with its 12-character referral code and the current consent version.
 * `POST /candidate/colleges/link`
 */
export async function linkCollegeByReferral(
  code: string,
  consentVersion: string,
): Promise<CollegeLinkResponse> {
  return apiRequest<CollegeLinkResponse>('/candidate/colleges/link', {
    method: 'POST',
    body: {
      code,
      consent_version: consentVersion,
    },
  });
}

/**
 * List pending invitations sent by colleges to this student's verified contact.
 * `GET /candidate/colleges/invitations`
 */
export async function getCollegeInvitations(): Promise<CandidateInvitationResponse[]> {
  return apiRequest<CandidateInvitationResponse[]>('/candidate/colleges/invitations');
}

/**
 * Accept a college's invitation, providing consent to be counted on their roster.
 * `POST /candidate/colleges/invitations/{id}/accept`
 */
export async function acceptCollegeInvitation(
  invitationId: string,
  consentVersion: string,
): Promise<CollegeLinkResponse> {
  return apiRequest<CollegeLinkResponse>(
    `/candidate/colleges/invitations/${invitationId}/accept`,
    {
      method: 'POST',
      body: {
        consent_version: consentVersion,
      },
    },
  );
}

/**
 * Decline a college's invitation.
 * `POST /candidate/colleges/invitations/{id}/decline`
 */
export async function declineCollegeInvitation(
  invitationId: string,
): Promise<void> {
  await apiRequest<void>(
    `/candidate/colleges/invitations/${invitationId}/decline`,
    {
      method: 'POST',
    },
  );
}

/**
 * Grant individual visibility to a linked college so they can view the student by name.
 * `POST /candidate/colleges/{college_id}/individual-visibility`
 */
export async function grantCollegeIndividualVisibility(
  collegeId: string,
  consentVersion: string,
): Promise<CollegeLinkResponse> {
  return apiRequest<CollegeLinkResponse>(
    `/candidate/colleges/${collegeId}/individual-visibility`,
    {
      method: 'POST',
      body: {
        consent_version: consentVersion,
      },
    },
  );
}

/**
 * Revoke consent for a college.
 * Scope 'ROSTER' disconnects completely and releases any held seat.
 * Scope 'INDIVIDUAL' stops sharing the candidate by name while keeping roster counting active.
 * `POST /candidate/colleges/{college_id}/revoke`
 */
export async function revokeCollegeConsent(
  collegeId: string,
  scope: CollegeConsentScope,
): Promise<RevokeConsentResponse> {
  return apiRequest<RevokeConsentResponse>(
    `/candidate/colleges/${collegeId}/revoke`,
    {
      method: 'POST',
      body: {
        scope,
      },
    },
  );
}

/**
 * Consolidate raw link rows into a unique list per college.
 * A college can hold both a ROSTER link and an INDIVIDUAL link at once.
 */
export function consolidateCollegeLinks(
  links: CollegeLinkResponse[] | null | undefined,
): LinkedCollege[] {
  const byCollege = new Map<string, LinkedCollege>();
  for (const item of links ?? []) {
    if (item.revoked_at) continue;
    const existing = byCollege.get(item.college_id);
    byCollege.set(item.college_id, {
      collegeId: item.college_id,
      name: existing?.name ?? item.college_name ?? 'College',
      byName: Boolean(existing?.byName) || item.scope === 'INDIVIDUAL',
      seatHeld: Boolean(existing?.seatHeld) || item.seat_held,
      since:
        existing && new Date(existing.since) < new Date(item.granted_at)
          ? existing.since
          : item.granted_at,
    });
  }
  return Array.from(byCollege.values());
}

/** Generate a 1-2 letter monogram for a college name. */
export function collegeMonogram(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'C'
  );
}

/** Calculate days left until expiration date. */
export function daysUntilExpiry(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}
