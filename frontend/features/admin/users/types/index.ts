export type UserSegment =
  | "candidates"
  | "employers"
  | "institutions";

export type UserState =
  | "Active"
  | "Pending"
  | "Suspended"
  | "Inactive";

export interface UserRow {
  id: string;
  name: string;
  initials: string;
  identifier: string;
  meta: string;
  state: UserState;
  joined: string;
}

/** Server-driven (cursor) pagination controls shared by the user tabs. */
export interface UsersPagination {
  pageSize: number;
  currentPage: number;
  hasNextPage: boolean;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onPageSizeChange: (pageSize: number) => void;
}

export interface AdminUsersState {
  segment: UserSegment;
  search: string;
  selectedId: string | null;

  candidates: UserRow[];
  employers: UserRow[];
  institutions: UserRow[];
}