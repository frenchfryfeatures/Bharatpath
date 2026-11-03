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
    <section aria-labelledby="app-heading" className="px-2 sm:px-3">
      <div className="grid gap-10 overflow-hidden rounded-[6px] bg-navy px-5 py-14 text-on-navy sm:px-10 lg:grid-cols-12 lg:items-center lg:gap-8 lg:px-14 lg:py-20">
        <div className="lg:col-span-6">
          <h2 id="app-heading" className="text-[36px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[48px]">
            Your job search,
            <br />
            in your pocket.
          </h2>
          <p className="mt-5 max-w-[46ch] text-[17px] text-on-navy-muted">
            Apply in a tap, hear the moment an application moves, practise interviews out loud and keep your streak going. In English, Hindi, Bengali, Kannada, Marathi, Punjabi and more.
          </p>
          <div className="mt-8">
            <AppBadges tone="light" />
          </div>
        </div>

        <div className="lg:col-span-5 lg:col-start-8">
          <ul data-ui className="space-y-2" aria-label="Example notifications from the app">
            {NOTES.map((n, i) => (
              <li
                key={n.text}
                className={`flex items-start gap-3 rounded-[8px] bg-paper p-4 text-ink ${i === 0 ? "" : "opacity-95"}`}
                style={{ marginLeft: `${i * 18}px` }}
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-saffron-soft text-ink">
                  <Bell className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px]">{n.text}</span>
                  <span className="block text-[13px] text-muted">BharatPath · {n.when}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
