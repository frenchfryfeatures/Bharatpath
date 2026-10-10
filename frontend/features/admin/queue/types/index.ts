export type QueueTab =
  | "kyb"
  | "integrity";

export type QueueRisk =
  | "High"
  | "Medium"
  | "Low";

export type QueueItemType =
  | "KYB"
  | "Integrity";

export interface QueueItem {
  id: string;
  name: string;
  initials: string;
  imageUrl?: string | null;
  imageFit?: "cover" | "contain";
  submitted: string;
  secondary: string;
  /** Integrity signals only (their severity). KYB submissions carry no risk. */
  risk: QueueRisk | null;
  /** When it was submitted (KYB) or flagged (integrity), formatted for the table. */
  date: string;
  /** KYB only: how the submission is being decided. */
  approval: string | null;
  type: QueueItemType;
  /** KYB only: sent back, corrected and submitted again. */
  resubmitted: boolean;
  /** KYB only: started after an earlier submission was rejected. */
  afterRejection: boolean;
}