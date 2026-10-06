import {
  BriefcaseBusiness,
  CalendarDays,
  ExternalLink,
  IndianRupee,
  Mail,
  MapPin,
  Sparkles,
  Star,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  EDUCATION_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  formatExperience,
  formatJobDate,
  formatJobSalary,
  JOB_TYPE_LABELS,
  labelOf,
  NOTICE_PERIOD_LABELS,
  RELOCATION_LABELS,
  SALARY_TYPE_LABELS,
  TIMELINE_LABELS,
  WORK_MODE_LABELS,
  type CandidateJobDetails,
} from "./job-details";

/*
 * ==========================================================================
 * JOB DESCRIPTION VIEW
 *
 * One layout for a posting wherever it is read: the candidate's job page,
 * the employer's job page and the composer's preview. Header card with the
 * facts a candidate scans first, then highlights, then the full description
 * broken into sections, then skills. A side column is the caller's.
 *
 * Each portal keeps its own look. `tone` picks the palette, radii and chip
 * colours of the portal it renders in; the structure is the same.
 * ==========================================================================
 */

export type JobViewTone = "student" | "employer";

const TONES = {
  student: {
    card: "rounded-[20px] border border-[#E7E0D4] bg-white p-5 sm:p-6",
    title: "text-[22px] font-bold leading-7 tracking-[-0.02em] text-[#0A1931]",
    heading: "text-[16px] font-bold text-[#0A1931]",
    subheading: "text-[14px] font-bold text-[#0A1931]",
    body: "text-[14px] leading-6 text-[#3A4761]",
    muted: "text-[12px] text-[#5F6B80]",
    label: "font-semibold text-[#68758A]",
    icon: "text-[#778197]",
    divider: "border-[#EEE9F3]",
    chip: "bg-[#F7F4EC] text-[#3A4761]",
    chipStrong: "bg-[#E6F1EA] text-[#1F6B45]",
    accent: "text-[#5F4DB2]",
    monogram: "bg-[#EFEBFA] text-[#5F4DB2]",
    badge: "bg-[rgba(244,214,133,0.16)] text-[#B9891A]",
    urgent: "bg-[#FDECEA] text-[#B42318]",
  },
  employer: {
    card: "rounded-[14px] border border-[#e1e5ea] bg-white p-5 shadow-[0_4px_12px_rgba(19,26,38,0.025)] sm:p-6",
    title: "text-[20px] font-bold leading-7 text-[#151b2b]",
    heading: "text-[15px] font-bold text-[#151b2b]",
    subheading: "text-[13px] font-bold text-[#151b2b]",
    body: "text-[14px] leading-6 text-[#283247]",
    muted: "text-[12px] text-[#687386]",
    label: "font-semibold text-[#687386]",
    icon: "text-[#7b8493]",
    divider: "border-[#e1e5ea]",
    chip: "bg-[#f4f5f7] text-[#283247]",
    chipStrong: "bg-[#edf2fa] text-[#28578f] ring-1 ring-[#2f5da8]/20",
    accent: "text-[#2f5da8]",
    monogram: "bg-[#edf2fa] text-[#28578f]",
    badge: "bg-[#fff7e8] text-[#8a5a00]",
    urgent: "bg-[#fff4f2] text-[#b42318]",
  },
} as const;

type Tone = (typeof TONES)[JobViewTone];

export interface JobDescriptionData {
  title: string;
  employerName: string | null;
  location: string | null;
  workMode: "ONSITE" | "HYBRID" | "REMOTE" | null;
  experienceMinMonths: number | null;
  salaryMinMinor: number;
  salaryMaxMinor: number;
  description: string;
  skills: string[];
  details: CandidateJobDetails;
  postedAt?: string | null;
}

export interface JobDescriptionViewProps {
  job: JobDescriptionData;
  tone: JobViewTone;
  /** Beside the facts in the header: eligibility, status. */
  badges?: ReactNode;
  /** Bottom right of the header card: Apply, Edit. */
  actions?: ReactNode;
  /** Bottom left of the header card, after posted and openings. */
  footerMeta?: ReactNode;
  /** The right-hand column. Omit for a single column. */
  aside?: ReactNode;
}

export function JobDescriptionView({
  job,
  tone,
  badges,
  actions,
  footerMeta,
  aside,
}: JobDescriptionViewProps) {
  const t = TONES[tone];

  return (
    <div
      className={
        aside
          ? "grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]"
          : "flex flex-col gap-4"
      }
    >
      <div className="flex min-w-0 flex-col gap-4">
        <JobHeaderCard
          job={job}
          t={t}
          badges={badges}
          actions={actions}
          footerMeta={footerMeta}
        />
        <JobHighlights job={job} t={t} />
        <JobDescriptionCard job={job} t={t} />
      </div>

      {aside ? <aside className="flex flex-col gap-4">{aside}</aside> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Header
 * ---------------------------------------------------------------------- */
function JobHeaderCard({
  job,
  t,
  badges,
  actions,
  footerMeta,
}: {
  job: JobDescriptionData;
  t: Tone;
  badges?: ReactNode;
  actions?: ReactNode;
  footerMeta?: ReactNode;
}) {
  const { details } = job;
  const experience = formatExperience(
    job.experienceMinMonths,
    details.compensation.experience_max_months,
  );
  const locations = [job.location, ...details.location.additional_locations]
    .map((place) => place?.trim())
    .filter(Boolean)
    .join(", ");
  const workMode = job.workMode ? WORK_MODE_LABELS[job.workMode] : null;
  const posted = formatJobDate(job.postedAt);

  return (
    <section className={t.card}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className={t.title}>{job.title}</h1>
          <p className={`mt-1 text-[14px] font-medium ${t.accent}`}>
            {job.employerName ?? "Employer"}
          </p>
        </div>
        <span
          aria-hidden="true"
          className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-[16px] font-bold ${t.monogram}`}
        >
          {monogram(job.employerName)}
        </span>
      </div>

      <div className={`mt-4 flex flex-col gap-2 ${t.body}`}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {experience ? (
            <Fact icon={<BriefcaseBusiness size={15} />} t={t}>
              {experience}
            </Fact>
          ) : null}
          <Fact icon={<IndianRupee size={15} />} t={t}>
            {formatJobSalary(
              job.salaryMinMinor,
              job.salaryMaxMinor,
              details.compensation,
            )}
          </Fact>
        </div>
        <Fact icon={<MapPin size={15} />} t={t}>
          {[workMode, locations || "Location not specified"]
            .filter(Boolean)
            .join(" · ")}
        </Fact>
      </div>

      {badges || details.featured || details.hiring.priority === "URGENT" ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {details.featured ? (
            <Badge className={t.badge} icon={<Star size={12} />}>
              Featured
            </Badge>
          ) : null}
          {details.hiring.priority === "URGENT" ? (
            <Badge className={t.urgent} icon={<Sparkles size={12} />}>
              Urgently hiring
            </Badge>
          ) : null}
          {badges}
        </div>
      ) : null}

      <div
        className={`mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between ${t.divider}`}
      >
        <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${t.muted}`}>
          {posted ? (
            <span>
              <span className={t.label}>Posted:</span> {posted}
            </span>
          ) : null}
          {details.basics.openings ? (
            <>
              {posted ? <Separator /> : null}
              <span>
                <span className={t.label}>Openings:</span>{" "}
                {details.basics.openings}
              </span>
            </>
          ) : null}
          {details.application.deadline ? (
            <>
              {posted || details.basics.openings ? <Separator /> : null}
              <span>
                <span className={t.label}>Apply by:</span>{" "}
                {formatJobDate(details.application.deadline)}
              </span>
            </>
          ) : null}
          {footerMeta}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
        ) : null}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * Highlights - the facts worth reading before the description.
 * ---------------------------------------------------------------------- */
function JobHighlights({ job, t }: { job: JobDescriptionData; t: Tone }) {
  const { details } = job;
  const jobType = labelOf(JOB_TYPE_LABELS, details.basics.job_type);
  const notice = labelOf(NOTICE_PERIOD_LABELS, details.requirements.notice_period);
  const education = labelOf(EDUCATION_LABELS, details.education.minimum);
  const highlights = [
    details.content.benefits.length
      ? `Perks: ${details.content.benefits.slice(0, 3).join(", ")}`
      : null,
    jobType && details.basics.openings
      ? `${jobType} role with ${details.basics.openings} ${details.basics.openings === 1 ? "opening" : "openings"}`
      : null,
    education ? `Minimum education: ${education}` : null,
    notice ? `Notice period: ${notice}` : null,
    details.hiring.interview_rounds.length
      ? `${details.hiring.interview_rounds.length} interview ${details.hiring.interview_rounds.length === 1 ? "round" : "rounds"}`
      : null,
    details.location.relocation_assistance ? "Relocation assistance offered" : null,
    details.compensation.negotiable ? "Salary is negotiable" : null,
  ].filter((item): item is string => Boolean(item));

  if (!highlights.length) return null;

  return (
    <section className={t.card}>
      <h2 className={`mb-3 ${t.heading}`}>Job highlights</h2>
      <BulletList items={highlights} t={t} />
    </section>
  );
}

/* -------------------------------------------------------------------------
 * The description proper
 * ---------------------------------------------------------------------- */
function JobDescriptionCard({ job, t }: { job: JobDescriptionData; t: Tone }) {
  const { details } = job;
  const { content, basics, education, requirements, hiring, application } =
    details;

  const roleFacts: Array<[string, string | null]> = [
    ["Role", job.title],
    ["Industry type", basics.industry || null],
    ["Department", basics.department || null],
    ["Job category", basics.category || null],
    ["Job type", labelOf(JOB_TYPE_LABELS, basics.job_type)],
    ["Employment type", labelOf(EMPLOYMENT_TYPE_LABELS, basics.employment_type)],
    ["Work mode", job.workMode ? WORK_MODE_LABELS[job.workMode] : null],
    ["Salary type", labelOf(SALARY_TYPE_LABELS, details.compensation.salary_type)],
    ["Salary", details.compensation.negotiable ? "Negotiable" : null],
  ];
  const educationFacts: Array<[string, string | null]> = [
    ["Minimum", labelOf(EDUCATION_LABELS, education.minimum)],
    ["UG", joinParts(education.ug_qualification, education.ug_specialization)],
    ["PG", joinParts(education.pg_qualification, education.pg_specialization)],
    ["Certifications", education.certifications.join(", ") || null],
  ];
  const requirementFacts: Array<[string, string | null]> = [
    ["Languages", requirements.languages.join(", ") || null],
    ["Notice period", labelOf(NOTICE_PERIOD_LABELS, requirements.notice_period)],
    ["Work authorisation", requirements.work_authorization || null],
    ["Relocation", labelOf(RELOCATION_LABELS, requirements.relocation)],
  ];
  const hiringFacts: Array<[string, string | null]> = [
    ["Interview rounds", hiring.interview_rounds.join(" → ") || null],
    ["Hiring timeline", labelOf(TIMELINE_LABELS, hiring.timeline)],
    ["Expected joining", formatJobDate(hiring.expected_joining_date)],
  ];
  const documents = [
    application.resume_required ? "Resume" : null,
    application.cover_letter_required ? "Cover letter" : null,
    application.portfolio_required ? "Portfolio" : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <section className={t.card}>
      <h2 className={`mb-3 ${t.heading}`}>Job description</h2>

      <p className={`whitespace-pre-line ${t.body}`}>
        {job.description || "No description was provided."}
      </p>

      <ListSection title="Key responsibilities" items={content.responsibilities} t={t} />
      <ListSection title="Required qualifications" items={content.required_qualifications} t={t} />
      <ListSection title="Preferred qualifications" items={content.preferred_qualifications} t={t} />
      <ListSection title="Benefits & perks" items={content.benefits} t={t} />

      <FactSection facts={roleFacts} t={t} />

      <FactSection title="Education" facts={educationFacts} t={t} />
      <FactSection title="Candidate requirements" facts={requirementFacts} t={t} />
      <FactSection title="Hiring process" facts={hiringFacts} t={t} />

      {application.method === "EXTERNAL" ||
      application.email ||
      documents.length ? (
        <div className="mt-5">
          <h3 className={`mb-2 ${t.subheading}`}>How to apply</h3>
          <div className={`flex flex-col gap-1.5 ${t.body}`}>
            {application.method === "EXTERNAL" && application.external_url ? (
              <a
                href={application.external_url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className={`inline-flex items-center gap-1.5 font-semibold underline-offset-2 hover:underline ${t.accent}`}
              >
                Apply on the employer&apos;s site
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            ) : (
              <span>Apply on BharatPath</span>
            )}
            {application.email ? (
              <span className="inline-flex items-center gap-1.5">
                <Mail size={14} className={t.icon} aria-hidden="true" />
                {application.email}
              </span>
            ) : null}
            {documents.length ? (
              <span>
                <span className={t.label}>Include:</span> {documents.join(", ")}
              </span>
            ) : null}
            {application.deadline ? (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays size={14} className={t.icon} aria-hidden="true" />
                Applications close {formatJobDate(application.deadline)}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <JobSkills job={job} t={t} />
    </section>
  );
}

function JobSkills({ job, t }: { job: JobDescriptionData; t: Tone }) {
  const { skills, content } = job.details;
  const primary = skills.primary.toLocaleLowerCase();
  const yearsFor = new Map(
    skills.experience.map((row) => [row.skill.toLocaleLowerCase(), row.years]),
  );
  const groups: Array<[string, string[]]> = [
    ["Preferred skills", skills.preferred],
    ["Technologies / tools", skills.tools],
    ["Nice to have", content.nice_to_have_skills],
  ];

  if (!job.skills.length && groups.every(([, items]) => !items.length)) {
    return null;
  }

  return (
    <div className={`mt-5 border-t pt-5 ${t.divider}`}>
      <h3 className={`mb-1 ${t.subheading}`}>Key skills</h3>
      <p className={`mb-3 ${t.muted}`}>
        Skills highlighted are the ones this role needs most.
      </p>
      <div className="flex flex-wrap gap-2">
        {job.skills.map((skill) => {
          const years = yearsFor.get(skill.toLocaleLowerCase());
          const isPrimary = skill.toLocaleLowerCase() === primary;
          return (
            <Chip key={skill} className={t.chipStrong}>
              {isPrimary ? <Star size={12} aria-label="Primary skill" /> : null}
              {skill}
              {years ? ` · ${years}+ yrs` : ""}
            </Chip>
          );
        })}
      </div>
      {groups.map(([title, items]) =>
        items.length ? (
          <div key={title} className="mt-4">
            <p className={`mb-2 text-[12px] ${t.label}`}>{title}</p>
            <div className="flex flex-wrap gap-2">
              {items.map((item) => (
                <Chip key={item} className={t.chip}>
                  {item}
                </Chip>
              ))}
            </div>
          </div>
        ) : null,
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Small pieces
 * ---------------------------------------------------------------------- */
function Fact({
  icon,
  t,
  children,
}: {
  icon: ReactNode;
  t: Tone;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={t.icon} aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </span>
  );
}

function Badge({
  className,
  icon,
  children,
}: {
  className: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[10px] font-bold uppercase leading-3 tracking-[0.06em] ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}

function Chip({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium leading-4 ${className}`}
    >
      {children}
    </span>
  );
}

function Separator() {
  return <span aria-hidden="true">|</span>;
}

function BulletList({ items, t }: { items: string[]; t: Tone }) {
  return (
    <ul className={`list-disc space-y-1.5 pl-5 ${t.body}`}>
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </ul>
  );
}

function ListSection({
  title,
  items,
  t,
}: {
  title: string;
  items: string[];
  t: Tone;
}) {
  if (!items.length) return null;
  return (
    <div className="mt-5">
      <h3 className={`mb-2 ${t.subheading}`}>{title}</h3>
      <BulletList items={items} t={t} />
    </div>
  );
}

function FactSection({
  title,
  facts,
  t,
}: {
  title?: string;
  facts: Array<[string, string | null]>;
  t: Tone;
}) {
  const present = facts.filter((fact): fact is [string, string] =>
    Boolean(fact[1]),
  );
  if (!present.length) return null;
  return (
    <div className="mt-5">
      {title ? <h3 className={`mb-2 ${t.subheading}`}>{title}</h3> : null}
      <dl className={`grid gap-1.5 ${t.body}`}>
        {present.map(([label, value]) => (
          <div key={label} className="flex flex-wrap gap-x-1.5">
            <dt className={t.label}>{label}:</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function joinParts(...parts: string[]): string | null {
  return parts.filter((part) => part.trim()).join(" in ") || null;
}

function monogram(name: string | null): string {
  return (name || "Employer")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
