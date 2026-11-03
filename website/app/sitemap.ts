import type { MetadataRoute } from "next";

import { AUDIENCES, SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

const PAGES = ["", "jobs/", "students/", "employers/", "colleges/", "about/", "faq/", "contact/", "privacy/", "terms/", "login/", "signup/"];

export default function sitemap(): MetadataRoute.Sitemap {
  const auth = AUDIENCES.flatMap((a) => [`login/${a}/`, `signup/${a}/`]);
  return [...PAGES, ...auth].map((p) => ({
    url: `${SITE_URL}/${p}`,
    changeFrequency: p === "jobs/" ? "daily" : "monthly",
    priority: p === "" ? 1 : p.startsWith("login") || p.startsWith("signup") ? 0.4 : 0.8,
  }));
}
