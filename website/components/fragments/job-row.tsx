import Link from "next/link";
import { Briefcase, Clock, IndianRupee, MapPin } from "lucide-react";

import { Chip } from "@/components/ui";
import { formatPay, postedLabel, type ExampleJob } from "@/content/jobs";

/** Organisation initials, in a tinted square: example roles name no employer, so no logo. */
export function OrgMark({ job, size = 44 }: { job: ExampleJob; size?: number }) {
  const tones = ["bg-lavender text-purple-deep", "bg-gold-soft text-gold-ink", "bg-green-soft text-green", "bg-lilac text-purple-night"];
  const tone = tones[job.id.length % tones.length];
  const initials = job.organisation
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
  return (
    <span className={`grid shrink-0 place-items-center rounded-xl text-[14px] font-bold ${tone}`} style={{ width: size, height: size }} aria-hidden="true">
      {initials}
    </span>
  );
}

/** Compact row for the hero search. */
export function JobRow({ job }: { job: ExampleJob }) {
  return (
    <div className="flex items-center gap-3">
      <OrgMark job={job} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-ink">{job.title}</p>
        <p className="truncate text-[13px] text-muted">
          {job.mode === "Remote" ? "Remote" : job.city} · {job.experience}
        </p>
      </div>
      <Chip tone="lavender">{job.type}</Chip>
    </div>
  );
}

/** The listing card used on the board and in featured grids. */
export function JobCard({ job, href }: { job: ExampleJob; href?: string }) {
  return (
    <article className="group relative flex h-full flex-col rounded-[20px] border border-line bg-paper p-5 shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:border-lilac-line hover:shadow-lift sm:p-6">
      <div className="flex items-start gap-4">
        <OrgMark job={job} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-bold leading-snug tracking-[-0.015em] text-ink">
            <Link href={href ?? `/jobs/${job.id}/`} className="after:absolute after:inset-0 after:rounded-[20px] focus-visible:outline-none">
              {job.title}
            </Link>
          </h3>
          <p className="mt-0.5 text-[14px] text-muted">{job.organisation}</p>
        </div>
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[14px] text-body">
        <li className="inline-flex items-center gap-1.5">
          <MapPin className="h-4 w-4 text-faint" aria-hidden="true" />
          {job.mode === "Remote" ? "Remote" : `${job.city}, ${job.state}`}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <Briefcase className="h-4 w-4 text-faint" aria-hidden="true" />
          {job.experience}
        </li>
        <li className="tabular inline-flex items-center gap-1.5">
          <IndianRupee className="h-4 w-4 text-faint" aria-hidden="true" />
          {formatPay(job.payFrom, job.payTo).replace("₹", "")}
        </li>
      </ul>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <Chip tone="lavender">{job.type}</Chip>
        {job.mode !== "On-site" && <Chip tone="green">{job.mode}</Chip>}
        <Chip tone={job.orgSize === "MSME" ? "gold" : "sand"}>{job.orgSize}</Chip>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 pt-5">
        <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          {postedLabel(job.postedDaysAgo)}
        </span>
        <span className="text-[14px] font-semibold text-purple group-hover:text-purple-deep">Apply →</span>
      </div>
    </article>
  );
}
