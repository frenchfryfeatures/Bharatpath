import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Briefcase, Building2, Clock, Factory, IndianRupee, Info, Laptop, MapPin } from "lucide-react";

import { JobCard, OrgMark } from "@/components/fragments/job-row";
import { buttonClass, Chip } from "@/components/ui";
import { EXAMPLE_JOBS, formatPay, postedLabel } from "@/content/jobs";

export const dynamicParams = false;

export function generateStaticParams() {
  return EXAMPLE_JOBS.map((j) => ({ id: j.id }));
}

export async function generateMetadata({ params }: PageProps<"/jobs/[id]">): Promise<Metadata> {
  const { id } = await params;
  const job = EXAMPLE_JOBS.find((j) => j.id === id);
  if (!job) return {};
  return {
    title: `${job.title}, ${job.mode === "Remote" ? "Remote" : job.city}`,
    description: `Example listing: ${job.title} at a ${job.organisation.toLowerCase()} in ${job.city}. ${job.experience}, ${formatPay(job.payFrom, job.payTo)}.`,
    alternates: { canonical: `/jobs/${job.id}/` },
  };
}

export default async function JobPage({ params }: PageProps<"/jobs/[id]">) {
  const { id } = await params;
  const job = EXAMPLE_JOBS.find((j) => j.id === id);
  if (!job) notFound();

  const similar = EXAMPLE_JOBS.filter((j) => j.id !== job.id && (j.industry === job.industry || j.state === job.state)).slice(0, 3);
  const facts = [
    { icon: MapPin, k: "Location", v: job.mode === "Remote" ? `Remote (team in ${job.city})` : `${job.city}, ${job.state}` },
    { icon: Laptop, k: "Work mode", v: job.mode },
    { icon: Briefcase, k: "Experience", v: job.experience },
    { icon: IndianRupee, k: "Pay", v: formatPay(job.payFrom, job.payTo) },
    { icon: Clock, k: "Job type", v: job.type },
    { icon: Factory, k: "Industry", v: job.industry },
    { icon: Building2, k: "Employer", v: job.orgSize },
  ];

  return (
    <div className="shell pb-10 pt-6 sm:pt-10">
      <Link href="/jobs/" className="inline-flex items-center gap-1.5 rounded-full px-1 text-[15px] font-semibold text-purple hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All jobs
      </Link>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px] lg:gap-8">
        <article className="space-y-4">
          <header className="rounded-[28px] border border-line bg-paper p-6 shadow-card sm:p-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <OrgMark job={job} size={64} />
              <div className="min-w-0 flex-1">
                <h1 className="text-[30px] font-bold leading-[1.1] tracking-[-0.035em] sm:text-[40px]">{job.title}</h1>
                <p className="mt-2 text-[17px] text-muted">{job.organisation}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Chip tone="lavender">{job.type}</Chip>
                  {job.mode !== "On-site" && <Chip tone="green">{job.mode}</Chip>}
                  <Chip tone={job.orgSize === "MSME" ? "gold" : "sand"}>{job.orgSize}</Chip>
                  <Chip tone="white">{postedLabel(job.postedDaysAgo)}</Chip>
                </div>
              </div>
            </div>
          </header>

          <p className="flex items-start gap-3 rounded-[20px] border border-[#efe0b0] bg-gold-soft px-5 py-4 text-[15px] text-body">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-gold-ink" aria-hidden="true" />
            This is an example listing that shows how roles appear on BharatPath. Live roles name the employer and can be applied to from the app.
          </p>

          <section aria-labelledby="facts" className="rounded-[28px] border border-line bg-paper p-6 shadow-card sm:p-8">
            <h2 id="facts" className="text-[20px] font-bold tracking-[-0.02em]">
              At a glance
            </h2>
            <dl className="mt-5 grid gap-3 sm:grid-cols-2">
              {facts.map(({ icon: Icon, k, v }) => (
                <div key={k} className="flex items-center gap-3 rounded-2xl bg-sand p-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-paper text-purple">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <dt className="text-[13px] text-muted">{k}</dt>
                    <dd className="tabular text-[15px] font-semibold">{v}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="skills" className="rounded-[28px] border border-line bg-paper p-6 shadow-card sm:p-8">
            <h2 id="skills" className="text-[20px] font-bold tracking-[-0.02em]">
              Skills asked for
            </h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {job.skills.map((s) => (
                <li key={s} className="rounded-full bg-lavender px-4 py-2 text-[15px] font-semibold text-purple-deep">
                  {s}
                </li>
              ))}
            </ul>
            <h2 className="mt-8 text-[20px] font-bold tracking-[-0.02em]">How applying works</h2>
            <ol className="mt-4 space-y-3 text-[16px] text-body">
              {["Create a free account and add your CV, or build one.", "Check what we read from your CV and confirm it.", "Apply in a tap and follow the application from viewed to hired."].map((s, i) => (
                <li key={s} className="flex gap-3">
                  <span className="tabular grid h-7 w-7 shrink-0 place-items-center rounded-full bg-purple text-[14px] font-bold text-white">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
          </section>
        </article>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-[28px] bg-purple p-6 text-white sm:p-7">
            <p className="text-[22px] font-bold leading-tight tracking-[-0.025em]">Interested in roles like this?</p>
            <p className="mt-2 text-[15px] text-white/80">Create a free account to see live vacancies near you and apply.</p>
            <div className="mt-6 grid gap-2">
              <Link href="/signup/student/" className={`${buttonClass("light", "lg")} w-full`}>
                Create free account
              </Link>
              <Link href="/login/student/" className="inline-flex min-h-[48px] items-center justify-center rounded-full border border-white/30 text-[15px] font-semibold text-white hover:bg-white/10">
                Sign in
              </Link>
            </div>
          </div>
        </aside>
      </div>

      {similar.length > 0 && (
        <section aria-labelledby="similar" className="mt-16">
          <h2 id="similar" className="mb-6 text-[26px] font-bold tracking-[-0.03em]">
            Similar roles
          </h2>
          <ul className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
            {similar.map((j) => (
              <li key={j.id}>
                <JobCard job={j} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
