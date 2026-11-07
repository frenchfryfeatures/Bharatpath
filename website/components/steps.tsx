import { ApplicationTracker } from "@/components/fragments/application-tracker";
import { ResumeReview, ResumeUpload } from "@/components/fragments/resume-review";
import { SectionHeading } from "@/components/ui";

const STEPS = [
  { n: "Step 1", title: "Start with your CV", body: "Upload the one you have, or build one from four templates in minutes. Free.", fragment: <ResumeUpload /> },
  { n: "Step 2", title: "Check what we read", body: "See every line we took from your CV and fix it. Only what you confirm is scored.", fragment: <ResumeReview /> },
  { n: "Step 3", title: "Apply and follow it", body: "Each application shows its stage, from viewed to hired. You confirm a hire yourself.", fragment: <ApplicationTracker reached={3} /> },
];

/** Three steps side by side, each with the screen it describes. */
export function Steps({ heading = "Three steps to your next job" }: { heading?: string }) {
  return (
    <section aria-labelledby="steps-heading" className="shell py-20 sm:py-24">
      <SectionHeading id="steps-heading" title={heading} lead="No guessing where your CV went. Every step is on screen." />
      <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.title} data-reveal className="flex flex-col overflow-hidden rounded-[24px] bg-lavender md:last:col-span-2 xl:last:col-span-1">
            <div className="p-6 sm:p-7">
              <p className="text-[14px] font-semibold text-purple">{s.n}</p>
              <h3 className="mt-1 text-[22px] font-bold tracking-[-0.025em]">{s.title}</h3>
              <p className="mt-2 text-[15px] text-body">{s.body}</p>
            </div>
            <div className="mt-auto flex justify-center px-4 pb-6 sm:px-6">{s.fragment}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}
