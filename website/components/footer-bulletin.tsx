"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Landmark } from "lucide-react";

/** The footer's way into the bulletin; left out on the bulletin itself. */
export function FooterBulletin() {
  const pathname = usePathname();
  if (pathname?.startsWith("/government-jobs")) return null;
  return (
    <Link
      href="/government-jobs/"
      className="group mb-14 flex flex-col gap-4 rounded-[24px] bg-white/[0.06] p-6 transition-colors hover:bg-white/10 sm:flex-row sm:items-center sm:justify-between sm:p-8"
    >
      <span className="flex items-start gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gold text-ink">
          <Landmark className="h-5 w-5" aria-hidden="true" />
        </span>
        <span>
          <span className="block text-[20px] font-bold tracking-[-0.02em]">Government jobs bulletin</span>
          <span className="mt-1 block max-w-[56ch] text-[15px] text-white/75">Recruitment notices collected from official government websites, each linked to its source.</span>
        </span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[15px] font-semibold text-gold">
        Open the bulletin <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </Link>
  );
}
