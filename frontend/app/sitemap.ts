import type { MetadataRoute } from "next";

import { EXAMPLE_JOBS } from "@/content/jobs";
import { AUDIENCES, SITE_URL } from "@/lib/site";

const PAGES = [
  "",
  "jobs",
  "government-jobs",
  "students",
  "employers",
  "colleges",
  "about",
  "faq",
  "contact",
  "privacy",
  "terms",
  "login",
  "signup",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const auth = AUDIENCES.map((a) => `signup/${a}`);
  const jobs = EXAMPLE_JOBS.map((j) => `jobs/${j.id}`);
  return [...PAGES, ...jobs, ...auth].map((p) => ({
    url: p ? `${SITE_URL}/${p}` : SITE_URL,
    changeFrequency: p === "jobs" || p === "government-jobs" ? "daily" : "monthly",
    priority: p === "" ? 1 : p.startsWith("login") || p.startsWith("signup") ? 0.4 : 0.8,
  }));
}

