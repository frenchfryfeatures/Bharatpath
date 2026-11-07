import Link from "next/link";

import { AppBadges } from "@/components/app-badges";
import { FooterBulletin } from "@/components/footer-bulletin";
import { Logo } from "@/components/logo";
import { CONTACT_EMAIL } from "@/lib/site";

const groups = [
  {
    title: "Job seekers",
    links: [
      { href: "/jobs/", label: "Browse jobs" },
      { href: "/government-jobs/", label: "Government jobs bulletin" },
      { href: "/students/", label: "How it works" },
      { href: "/login/student/", label: "Candidate sign in" },
      { href: "/signup/student/", label: "Create candidate account" },
    ],
  },
  {
    title: "Employers",
    links: [
      { href: "/employers/", label: "Hire on BharatPath" },
      { href: "/login/employer/", label: "Employer sign in" },
      { href: "/signup/employer/", label: "Create business account" },
    ],
  },
  {
    title: "Colleges",
    links: [
      { href: "/colleges/", label: "Placement partnership" },
      { href: "/login/college/", label: "College sign in" },
      { href: "/signup/college/", label: "Register your college" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about/", label: "About us" },
      { href: "/faq/", label: "Questions" },
      { href: "/contact/", label: "Contact" },
      { href: "/privacy/", label: "Privacy" },
      { href: "/terms/", label: "Terms" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 bg-ink text-white sm:mt-32">
      <div className="shell py-14 sm:py-20">
        <FooterBulletin />

        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <Logo tone="light" />
            <p className="mt-5 max-w-[34ch] text-[16px] text-white/70">
              Jobs, hiring and campus placements for every corner of Bharat: candidates, employers and colleges on one platform.
            </p>
            <div className="mt-8">
              <p className="mb-3 text-[14px] font-semibold text-white/80">Get the app</p>
              <AppBadges tone="light" />
            </div>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4 lg:col-span-8">
            {groups.map((g) => (
              <div key={g.title}>
                <p className="mb-4 text-[14px] font-semibold text-white">{g.title}</p>
                <ul className="space-y-3">
                  {g.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="text-[15px] text-white/75 transition-colors hover:text-white">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-white/10 pt-6 text-[14px] text-white/70 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} BharatPath. Made in India, for India.</p>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-white">
            {CONTACT_EMAIL}
          </a>
        </div>
      </div>
    </footer>
  );
}
