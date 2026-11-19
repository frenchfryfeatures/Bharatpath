import type { Metadata } from "next";
import { Building2, GraduationCap, LifeBuoy, Mail, UserRound } from "lucide-react";

import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with BharatPath: candidate help, employer and college partnerships, and grievances.",
  alternates: { canonical: "/contact/" },
};

const mail = (subject: string) => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;

const ROUTES = [
  { icon: UserRound, title: "Candidates", body: "Trouble signing in, a question about your CV or an application.", subject: "Candidate help" },
  { icon: Building2, title: "Employers", body: "Setting up your organisation, hiring at volume, or a demo for your team.", subject: "Employer enquiry" },
  { icon: GraduationCap, title: "Colleges", body: "Bringing your students on board, seats for your batch, or a campus visit.", subject: "College partnership" },
  { icon: LifeBuoy, title: "Grievances", body: "A complaint about content, an account or how your data was handled.", subject: "Grievance" },
];

export default function ContactPage() {
  return (
    <section className="shell pb-10 pt-14 lg:pt-20">
      <h1 className="text-[clamp(40px,5.6vw,80px)] font-bold leading-[1] tracking-[-0.045em]">Talk to us</h1>
      <p className="mt-5 max-w-[52ch] text-[17px] text-muted">
        Write to us and a person will reply, usually within one working day. Choose what it is about so it reaches the right team.
      </p>
      <ul className="mt-12 grid gap-2 md:grid-cols-2">
        {ROUTES.map(({ icon: Icon, title, body, subject }) => (
          <li key={title}>
            <a href={mail(subject)} className="group flex h-full flex-col justify-between gap-8 rounded-[24px] bg-sand p-6 transition-colors hover:bg-lavender sm:p-8">
              <span>
                <Icon className="h-6 w-6 text-purple" aria-hidden="true" />
                <span className="mt-4 block text-[22px] font-semibold tracking-[-0.02em]">{title}</span>
                <span className="mt-2 block max-w-[44ch] text-muted">{body}</span>
              </span>
              <span className="inline-flex items-center gap-2 text-[15px] font-medium text-purple">
                <Mail className="h-4 w-4" aria-hidden="true" /> {CONTACT_EMAIL}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-10 max-w-[70ch] text-[15px] text-muted">
        Registered office and Grievance Officer details will be published here before launch, as the Information Technology Rules, 2021 and the Digital Personal Data Protection Act, 2023 require.
      </p>
    </section>
  );
}
