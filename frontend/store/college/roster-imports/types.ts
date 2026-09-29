export type RosterImportState =
  | "PREVIEW"
  | "COMMITTED"
  | "DISCARDED";

export type RosterRowState =
  | "VALID"
  | "INVALID"
  | "DUPLICATE";

export interface InvitationCounts {
  pending: number;
  sent: number;
  accepted: number;
  declined: number;
  expired: number;
}

export interface RosterImport {
  id: string;
  fileName: string;
  state: RosterImportState;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  ignoredColumns: string[];
  createdAt: string;
  committedAt: string | null;
  invitations: InvitationCounts;
}

export interface RosterImportsPage {
  items: RosterImport[];
  nextCursor: string | null;
  invitationTotals: InvitationCounts;
}

export interface RosterRow {
  rowNumber: number;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  studentRef: string | null;
  rowState: RosterRowState;
  issues: string[];
  inviteState: string | null;
}

export interface RosterRowsPage {
  items: RosterRow[];
  nextCursor: string | null;
}

export interface InvitationsSent {
  sent: number;
  invitations: InvitationCounts;
}
