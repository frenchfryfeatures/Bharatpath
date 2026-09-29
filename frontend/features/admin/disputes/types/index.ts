export type DisputeTab =
  | "open"
  | "resolved"
  | "rejected";

export type DisputeStatus =
  | "Open"
  | "Investigating"
  | "Pending"
  | "Resolved"
  | "Rejected";

export interface DisputeEvidence {
  label: string;
  meta: string;
}

export interface Dispute {
  id: string;
  title: string;
  parties: string;
  status: DisputeStatus;
  raised: string;
  age: string;
  claim: string;
  evidence: DisputeEvidence[];
}

export type AuditIcon =
  | "check"
  | "file"
  | "alert"
  | "toggle"
  | "gavel";

export interface AuditItem {
  id: string;
  description: string;
  operator: string;
  timestamp: string;
  icon: AuditIcon;
}

export interface AdminDisputesState {
  tab: DisputeTab;
  openId: string | null;

  disputes: Dispute[];
  auditItems: AuditItem[];
}