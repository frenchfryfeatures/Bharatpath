import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";

import { GovBulletin } from "@/components/gov-bulletin";
import { GOV_BULLETIN } from "@/content/gov";

export const metadata: Metadata = {
  title: "Government jobs bulletin",
  description: "Recruitment notices from official government websites in one list, each linked to its official source.",
  alternates: { canonical: "/government-jobs/" },
};

const updated = GOV_BULLETIN.fetchedAt
  ? new Date(GOV_BULLETIN.fetchedAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })
  : null;

export default function GovernmentJobsPage() {
  const live = GOV_BULLETIN.sources.filter((s) => s.ok);
  return (
    <div className="shell pb-10 pt-8 sm:pt-12">
      <div className="grid gap-8 lg:grid-cols-[1fr_380px] lg:items-end">
        <div>
          <h1 className="text-[clamp(36px,4.6vw,64px)] font-bold leading-[1.02] tracking-[-0.045em]">
            Government jobs <span className="text-purple">bulletin</span>
          </h1>
          <p className="mt-4 max-w-[60ch] text-[17px] text-body">
            Recruitment notices from official government websites, gathered in one list so you do not have to check a dozen sites every morning. Every notice opens on its official source.
          </p>
          <p className="mt-3 text-[15px] text-muted">
            {updated ? `Updated ${updated} IST · ${live.length} of ${GOV_BULLETIN.sources.length} sources answered` : "Sources are being connected"}
          </p>
        </div>
        <aside className="flex items-start gap-3 rounded-[24px] border border-[#efe0b0] bg-gold-soft p-5 text-[15px] text-body">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-gold-ink" aria-hidden="true" />
          <p>
            BharatPath does not run these recruitments. Read the official notification for eligibility and dates, apply only on the official website, and never pay anyone who promises a government job.
          </p>
        </aside>
      </div>

      <div className="mt-10">
        <GovBulletin data={GOV_BULLETIN} />
      </div>

      {GOV_BULLETIN.sources.length > 0 && (
        <section aria-labelledby="sources" className="mt-14">
          <h2 id="sources" className="text-[22px] font-bold tracking-[-0.02em]">
            Where these come from
          </h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {GOV_BULLETIN.sources.map((s) => (
              <li key={s.id}>
                {s.homepage ? (
                  <a href={s.homepage} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-paper px-4 text-[15px] font-medium hover:border-lilac-line hover:bg-lavender">
                    {s.name}
                  </a>
                ) : (
                  <span className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-paper px-4 text-[15px] font-medium">{s.name}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
