#!/usr/bin/env node
/**
 * Builds the government jobs bulletin.
 *
 * Reads content/gov-sources.json, fetches each source's feed, and writes
 * content/gov-jobs.json, which the /government-jobs/ page renders at build
 * time. Runs before every `npm run build`; run it alone with
 * `npm run fetch:gov`.
 *
 * It never fails the build. A source that cannot be reached keeps the
 * notices it had last time, and is marked as failing.
 *
 * Only a notice's title, link and dates are kept. Descriptions are dropped on
 * purpose: they carry eligibility text, including age limits, and the
 * platform has no age field anywhere (invariant 5). The official notice,
 * one click away, is the place to read eligibility.
 */

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = join(ROOT, "content", "gov-sources.json");
const OUT = join(ROOT, "content", "gov-jobs.json");

const MAX_PER_SOURCE = 80;
const MAX_TOTAL = 400;
const MAX_AGE_DAYS = 120;
const TIMEOUT_MS = 20_000;

const CATEGORIES = [
  ["Railways", /\b(rail|railway|rrb|rrc|metro)\b/i],
  ["Defence", /\b(army|navy|air force|defen[cs]e|agniveer|coast guard|bsf|crpf|cisf|itbp|ssb|assam rifles)\b/i],
  ["Police", /\bpolice|constable|home guard\b/i],
  ["Banking", /\b(bank|ibps|sbi|rbi|nabard)\b/i],
  ["Teaching", /\b(teacher|tgt|pgt|prt|lecturer|professor|faculty|school|kvs|nvs)\b/i],
  ["Health", /\b(nurse|nursing|medical|doctor|aiims|health|pharmac|anm|gnm|staff nurse)\b/i],
  ["Engineering & PSU", /\b(engineer|psu|bhel|ongc|ntpc|gail|iocl|bel|hal|drdo|isro|apprentice)\b/i],
  ["Central services", /\b(upsc|ssc|civil services|cgl|chsl|mts)\b/i],
  ["State services", /\b(psc|state service|subordinate|patwari|panchayat|tehsil)\b/i],
];

const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : "";
};

const isoDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const pick = (obj, path) => (path ? path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj) : undefined);

function safeLink(href, base) {
  try {
    const u = new URL(href, base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function parseFeed(text) {
  const items = [];
  const blocks = text.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? text.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const b of blocks) {
    const atomLink = b.match(/<link[^>]*href="([^"]+)"/i)?.[1];
    items.push({
      title: tag(b, "title"),
      link: tag(b, "link") || atomLink || tag(b, "guid"),
      published: tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"),
      lastDate: null,
    });
  }
  return items;
}

function parseJson(text, source) {
  const map = source.json ?? {};
  const data = JSON.parse(text);
  const list = map.items ? pick(data, map.items) : data;
  if (!Array.isArray(list)) throw new Error(`"${map.items ?? "(root)"}" is not a list`);
  return list.map((row) => ({
    title: String(pick(row, map.title ?? "title") ?? ""),
    link: String(pick(row, map.link ?? "link") ?? ""),
    published: pick(row, map.published ?? "published"),
    lastDate: pick(row, map.lastDate ?? "lastDate") ?? null,
  }));
}

async function fetchSource(source) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(source.feed, {
      signal: ctrl.signal,
      headers: { "user-agent": "BharatPathBulletin/1.0 (+public job bulletin)", accept: "application/rss+xml, application/atom+xml, application/json, text/xml, */*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const raw = source.format === "json" ? parseJson(text, source) : parseFeed(text);
    const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
    return raw
      .map((r) => {
        const link = safeLink(r.link, source.homepage || source.feed);
        const title = decode(String(r.title || ""));
        if (!link || !title) return null;
        const publishedAt = isoDate(r.published);
        if (publishedAt && Date.parse(publishedAt) < cutoff) return null;
        const category = source.category || CATEGORIES.find(([, re]) => re.test(title))?.[0] || "Other";
        return {
          id: createHash("sha1").update(link).digest("hex").slice(0, 12),
          title: title.slice(0, 240),
          link,
          sourceId: source.id,
          sourceName: source.name,
          state: source.state || "All India",
          category,
          publishedAt,
          lastDate: isoDate(r.lastDate),
        };
      })
      .filter(Boolean)
      .slice(0, MAX_PER_SOURCE);
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const { sources = [] } = await readJson(SOURCES, { sources: [] });
  const previous = await readJson(OUT, { notices: [] });

  if (sources.length === 0) {
    await writeFile(OUT, JSON.stringify({ fetchedAt: null, sources: [], notices: [] }, null, 2) + "\n");
    console.log("gov-jobs: no sources configured, bulletin is empty");
    return;
  }

  const results = await Promise.all(
    sources.map(async (s) => {
      try {
        const notices = await fetchSource(s);
        return { meta: { id: s.id, name: s.name, homepage: s.homepage ?? null, state: s.state || "All India", ok: true, count: notices.length }, notices };
      } catch (err) {
        const kept = (previous.notices ?? []).filter((n) => n.sourceId === s.id);
        console.warn(`gov-jobs: ${s.id} failed (${err.message}); keeping ${kept.length} earlier notices`);
        return { meta: { id: s.id, name: s.name, homepage: s.homepage ?? null, state: s.state || "All India", ok: false, count: kept.length, error: String(err.message).slice(0, 200) }, notices: kept };
      }
    }),
  );

  const seen = new Set();
  const notices = results
    .flatMap((r) => r.notices)
    .filter((n) => (seen.has(n.link) ? false : seen.add(n.link)))
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, MAX_TOTAL);

  await writeFile(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), sources: results.map((r) => r.meta), notices }, null, 2) + "\n");
  console.log(`gov-jobs: ${notices.length} notices from ${results.filter((r) => r.meta.ok).length}/${sources.length} sources`);
}

main().catch((err) => {
  // Never fail the build over the bulletin: the page shows what it has.
  console.warn(`gov-jobs: ${err.message}`);
});
