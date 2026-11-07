import Link from "next/link";
import { Check } from "lucide-react";

import { ButtonLink } from "@/components/ui";

/** A two-column band: the pitch and points on one side, a working piece of the product on the other. */
export function AudienceBand({
  id,
  title,
  lead,
  points,
  primary,
  secondary,
  fragment,
  tone = "purple",
  flip = false,
}: {
  id: string;
  title: string;
  lead: string;
  points: string[];
  primary: { href: string; label: string };
  secondary?: { href: string; label: string };
  fragment: React.ReactNode;
  tone?: "purple" | "lilac" | "gold";
  flip?: boolean;
}) {
  const stage = { purple: "bg-purple", lilac: "bg-lilac", gold: "bg-gold-soft" }[tone];
  return (
    <section aria-labelledby={id} className="shell py-10 sm:py-14">
      <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
        <div className={`min-w-0 ${flip ? "lg:order-2" : ""}`}>
          <h2 id={id} className="text-[28px] font-bold leading-[1.1] tracking-[-0.03em] sm:text-[36px]">
            {title}
          </h2>
          <p className="mt-3 max-w-[52ch] text-[16px] text-muted sm:text-[17px]">{lead}</p>
          <ul className="mt-6 space-y-3">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-3 text-[16px] text-body">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-green-soft text-green">
                  <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
                </span>
                {p}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href={primary.href}>{primary.label}</ButtonLink>
            {secondary && (
              <Link href={secondary.href} className="inline-flex min-h-[44px] items-center px-2 text-[15px] font-semibold text-purple hover:underline">
                {secondary.label}
              </Link>
            )}
          </div>
        </div>
        <div className={`flex min-h-[380px] min-w-0 items-center justify-center rounded-[24px] p-5 sm:p-10 ${stage} ${flip ? "lg:order-1" : ""}`}>{fragment}</div>
      </div>
    </section>
  );
}
