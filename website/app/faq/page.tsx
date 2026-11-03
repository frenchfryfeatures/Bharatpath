import type { Metadata } from "next";

import { FaqList } from "@/components/faq-list";
import { COLLEGE_FAQ, EMPLOYER_FAQ, STUDENT_FAQ } from "@/content/faq";

export const metadata: Metadata = {
  title: "Questions",
  description: "Answers for candidates, employers and colleges using BharatPath.",
  alternates: { canonical: "/faq/" },
};

export default function FaqPage() {
  return (
    <>
      <section className="mx-auto max-w-[1240px] px-4 pt-14 sm:px-6 lg:px-10 lg:pt-20">
        <h1 className="text-[clamp(40px,5.6vw,80px)] font-semibold leading-[1] tracking-[-0.045em]">Questions</h1>
      </section>
      <FaqList items={STUDENT_FAQ} heading="For candidates" group="faq-students" />
      <FaqList items={EMPLOYER_FAQ} heading="For employers" group="faq-employers" />
      <FaqList items={COLLEGE_FAQ} heading="For colleges" group="faq-colleges" />
    </>
  );
}
