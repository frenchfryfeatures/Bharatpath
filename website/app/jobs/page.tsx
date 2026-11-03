import type { Metadata } from "next";

import { JobBoard } from "@/components/job-board";
import { AppDownload } from "@/components/app-download";

export const metadata: Metadata = {
  title: "Jobs across India",
  description: "Browse roles by city, work mode, job type, experience, employer size and pay. Freshers, internships, apprenticeships, MSMEs and more.",
  alternates: { canonical: "/jobs/" },
};

export default function JobsPage() {
  return (
    <>
      <section className="mx-auto max-w-[1240px] px-4 pb-8 pt-12 sm:px-6 lg:px-10 lg:pt-16">
        <h1 className="text-[clamp(36px,4.6vw,64px)] font-semibold leading-[1.02] tracking-[-0.04em]">Jobs across India</h1>
        <p className="mt-4 max-w-[56ch] text-[17px] text-muted">
          From a first apprenticeship to an operations role, at workshops, startups, hospitals, schools and national chains. Filter the way you actually look for work.
        </p>
      </section>
      <JobBoard />
      <div className="pt-16">
        <AppDownload />
      </div>
    </>
  );
}
