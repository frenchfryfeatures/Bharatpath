import Link from "next/link";

import { AppBadges } from "@/components/app-badges";
import { CONTACT_EMAIL } from "@/lib/site";

const groups = [
  {
    title: "Candidates",
    links: [
      { href: "/jobs/", label: "Browse jobs" },
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
    <footer className="px-2 pb-2 pt-24 sm:px-3 sm:pb-3">
      <div className="grid gap-2 lg:grid-cols-12">
        <div className="flex flex-col justify-between gap-10 rounded-[6px] bg-surface p-6 sm:p-8 lg:col-span-4">
          <p className="max-w-[30ch] text-[22px] font-medium leading-snug tracking-[-0.015em]">
            Work, workers and colleges across Bharat, on one honest platform.
          </p>
          <div>
            <p className="mb-3 text-[15px] text-muted">Get the app</p>
            <AppBadges />
          </div>
        </div>

        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-8 rounded-[6px] bg-surface p-6 sm:grid-cols-4 sm:p-8 lg:col-span-8">
          {groups.map((g) => (
            <div key={g.title}>
              <p className="mb-3 text-[15px] font-semibold">{g.title}</p>
              <ul className="space-y-2">
                {g.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-[15px] text-muted transition-colors hover:text-ink">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="flex min-h-[200px] items-end overflow-hidden rounded-[6px] bg-navy p-6 sm:p-8 lg:col-span-8 lg:min-h-[280px]">
          <p className="select-none text-[17vw] font-semibold leading-[0.8] tracking-[-0.05em] text-on-navy lg:text-[10.5vw]" aria-hidden="true">
            Bharat<span className="text-saffron">Path</span>
          </p>
        </div>

        <Link
          href="/signup/"
          className="group flex min-h-[200px] flex-col justify-between rounded-[6px] bg-saffron p-6 text-ink transition-colors hover:bg-[#ffc533] sm:p-8 lg:col-span-4 lg:min-h-[280px]"
        >
          <span className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">Find your path</span>
          <span className="flex items-end justify-between gap-4">
            <span className="text-[15px]">
              Questions? <span className="underline">{CONTACT_EMAIL}</span>
            </span>
            <svg viewBox="0 0 48 48" className="h-12 w-12 shrink-0 transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true">
              <path d="M8 24h30M26 12l12 12-12 12" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="square" />
            </svg>
          </span>
        </Link>
      </div>
      <p className="px-4 pb-4 pt-6 text-[13px] text-muted sm:px-6">
        © {new Date().getFullYear()} BharatPath. Made in India, for India.
      </p>
    </footer>
  );
}
