import Link from "next/link";

interface Action {
  href: string;
  label: string;
}

/**
 * Inner-page hero: a two-line headline on the left, the page's own fragment
 * on a navy stage on the right, split by tone alone.
 */
export function PageHero({
  lines,
  lead,
  primary,
  secondary,
  fragment,
}: {
  lines: [string, string];
  lead: string;
  primary: Action;
  secondary?: Action;
  fragment: React.ReactNode;
}) {
  return (
    <section className="px-2 sm:px-3">
      <div className="grid overflow-hidden rounded-[6px] lg:min-h-[78svh] lg:grid-cols-2">
        <div className="order-2 flex flex-col justify-end bg-surface px-5 py-10 sm:px-10 lg:order-1 lg:px-12 lg:py-14">
          <h1 className="text-[clamp(38px,5.2vw,76px)] font-semibold leading-[1.02] tracking-[-0.04em]">
            <span className="mask-line">
              <span>{lines[0]}</span>
            </span>
            <span className="mask-line">
              <span>{lines[1]}</span>
            </span>
          </h1>
          <div className="fade-up">
            <p className="mt-5 max-w-[46ch] text-[17px] text-muted">{lead}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href={primary.href} className="rounded-[6px] bg-navy px-5 py-3 text-[15px] font-medium text-on-navy transition-colors hover:bg-navy-deep">
                {primary.label}
              </Link>
              {secondary && (
                <Link href={secondary.href} className="rounded-[6px] px-4 py-3 text-[15px] font-medium text-ink transition-colors hover:bg-line">
                  {secondary.label}
                </Link>
              )}
            </div>
          </div>
        </div>
        <div className="order-1 flex items-center justify-center bg-navy px-4 py-12 sm:px-10 lg:order-2">{fragment}</div>
      </div>
    </section>
  );
}
