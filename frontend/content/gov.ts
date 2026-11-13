import data from "@/content/gov-jobs.json";

export interface GovNotice {
  id: string;
  title: string;
  link: string;
  sourceId: string;
  sourceName: string;
  state: string;
  category: string;
  publishedAt: string | null;
  lastDate: string | null;
}

export interface GovSource {
  id: string;
  name: string;
  homepage: string | null;
  state: string;
  ok: boolean;
  count: number;
  error?: string;
}

export interface GovBulletinData {
  fetchedAt: string | null;
  sources: GovSource[];
  notices: GovNotice[];
}

/** Written by scripts/fetch-gov-jobs.mjs before every build. */
export const GOV_BULLETIN = data as GovBulletinData;
