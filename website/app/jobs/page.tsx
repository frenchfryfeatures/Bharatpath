import type { Metadata } from "next";

import { AppDownload } from "@/components/app-download";
import { JobBoard } from "@/components/job-board";

export const metadata: Metadata = {
  title: "Jobs across India",
  description: "Browse roles by city, work mode, job type, experience, employer size and pay. Freshers, internships, apprenticeships, MSMEs and more.",
  alternates: { canonical: "/jobs/" },
};

export default function JobsPage() {
  return (
    <>
      <section className="shell pb-8 pt-8 sm:pt-12">
        <h1 className="text-[clamp(36px,4.6vw,64px)] font-bold leading-[1.02] tracking-[-0.045em]">
          Jobs across <span className="text-purple">India</span>
        </h1>
        <p className="mt-4 max-w-[60ch] text-[17px] text-body">
          From a first apprenticeship to an operations role, at workshops, startups, hospitals, schools and national chains. Filter the way you actually look for work.
        </p>
      </section>
      <JobBoard />
      <AppDownload />
    </>
  );
}
