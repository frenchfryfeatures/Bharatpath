export type ReferralCodeState =
  | "ACTIVE"
  | "EXPIRED"
  | "REVOKED"
  | "EXHAUSTED";

export interface ReferralCode {
  id: string;
  code: string;
  state: ReferralCodeState;
  uses: number;
  maxUses: number | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface ReferralCodesPage {
  items: ReferralCode[];
  nextCursor: string | null;
}
