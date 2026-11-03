import { Bell } from "lucide-react";

import { AppBadges } from "@/components/app-badges";

const NOTES = [
  { when: "2 min ago", text: "Your application for Staff nurse moved to Shortlisted." },
  { when: "Yesterday", text: "A healthcare diagnostics network opened your profile." },
  { when: "Mon", text: "3 new roles in Nagpur match your skills." },
];

/** The app band: download links, and what the app is for, shown rather than listed. */
export function AppDownload() {
  return (
    <section aria-labelledby="app-heading" className="shell py-10 sm:py-14">
      <div className="relative grid gap-10 overflow-hidden rounded-[28px] bg-purple px-6 py-12 text-white sm:px-10 lg:grid-cols-2 lg:items-center lg:gap-12 lg:px-14 lg:py-16">
        <div>
          <h2 id="app-heading" className="text-[32px] font-bold leading-[1.05] tracking-[-0.035em] sm:text-[44px]">
            Your job search, in your pocket
          </h2>
          <p className="mt-4 max-w-[46ch] text-[17px] text-white/90">
            Apply in a tap, hear the moment an application moves, practise interviews out loud and keep your streak going. In English, Hindi, Bengali, Kannada, Marathi, Punjabi and more.
          </p>
          <div className="mt-8">
            <AppBadges tone="light" />
          </div>
        </div>
        <ul data-ui className="space-y-3" aria-label="Example notifications from the app">
          {NOTES.map((n, i) => (
            <li key={n.text} className="flex items-start gap-3 rounded-[20px] bg-paper p-4 text-ink shadow-[0_10px_30px_rgba(46,38,103,0.25)] lg:max-w-[440px]" style={{ marginLeft: `${i * 20}px` }}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lavender text-purple">
                <Bell className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-medium leading-snug">{n.text}</span>
                <span className="mt-0.5 block text-[13px] text-muted">BharatPath · {n.when}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
