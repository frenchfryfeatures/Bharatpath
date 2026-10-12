/**
 * BharatPath - College Types
 *
 * Candidate-facing college integration types:
 *   - `GET /candidate/colleges`
 *   - `GET /candidate/colleges/consent-terms`
 *   - `POST /candidate/colleges/link`
 *   - `GET /candidate/colleges/invitations`
 *   - `POST /candidate/colleges/invitations/{id}/accept`
 *   - `POST /candidate/colleges/invitations/{id}/decline`
 *   - `POST /candidate/colleges/{id}/individual-visibility`
 *   - `POST /candidate/colleges/{id}/revoke`
 */

export type CollegeConsentScope = 'ROSTER' | 'INDIVIDUAL';

export type CollegeLinkGrantedVia = 'REFERRAL_CODE' | 'INVITATION';

export interface CollegeLinkResponse {
  college_id: string;
  college_name: string;
  college_logo_url?: string | null;
  scope: CollegeConsentScope;
  granted_via: CollegeLinkGrantedVia;
  granted_at: string;
  revoked_at: string | null;
  seat_held: boolean;
}

export interface LinkedCollege {
  collegeId: string;
  name: string;
  logoUrl?: string | null;
  byName: boolean;
  seatHeld: boolean;
  since: string;
}

export interface ConsentTermsResponse {
  consent_version: string;
  scope: CollegeConsentScope;
  key: string;
  text: string;
}

export interface CandidateInvitationResponse {
  id: string;
  college_name: string;
  college_logo_url?: string | null;
  sent_at: string;
  expires_at: string;
}

export interface RevokeConsentResponse {
  revoked: boolean;
  college_id: string;
  scope: CollegeConsentScope;
}
