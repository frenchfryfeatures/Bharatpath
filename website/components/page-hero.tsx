import { ButtonLink } from "@/components/ui";

interface Action {
  href: string;
  label: string;
}

/**
 * Inner-page hero: the headline and actions on the left, the page's own
 * working piece of the product on a tinted stage on the right.
 */
export function PageHero({
  lines,
  lead,
  primary,
  secondary,
  fragment,
  stage = "lavender",
  children,
}: {
  lines: [string, string];
  lead: string;
  primary?: Action;
  secondary?: Action;
  fragment: React.ReactNode;
  stage?: "lavender" | "purple" | "gold";
  children?: React.ReactNode;
}) {
  const stageCls = { lavender: "bg-lavender", purple: "bg-purple", gold: "bg-gold-soft" }[stage];
  return (
    <section className="shell pb-10 pt-6 sm:pt-10 lg:pb-16">
      <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
        <div className="min-w-0">
          <h1 className="text-[clamp(40px,5.4vw,76px)] font-bold leading-[1.02] tracking-[-0.035em] 2xl:text-[84px]">
            <span className="mask-line">
              <span>{lines[0]}</span>
            </span>
            <span className="mask-line">
              <span className="text-purple">{lines[1]}</span>
            </span>
          </h1>
          <div className="fade-up">
            <p className="mt-5 max-w-[50ch] text-[17px] text-body sm:text-[18px]">{lead}</p>
            {children}
            {(primary || secondary) && (
              <div className="mt-8 flex flex-wrap items-center gap-3">
                {primary && (
                  <ButtonLink href={primary.href} size="lg">
                    {primary.label}
                  </ButtonLink>
                )}
                {secondary && (
                  <ButtonLink href={secondary.href} tone="secondary" size="lg">
                    {secondary.label}
                  </ButtonLink>
                )}
              </div>
            )}
          </div>
        </div>
        <div className={`fade-up flex min-w-0 items-center justify-center rounded-[28px] p-4 sm:p-8 lg:min-h-[540px] lg:p-10 ${stageCls}`}>
          <div className="w-full min-w-0 max-w-[460px]">{fragment}</div>
        </div>
      </div>
    </section>
  );
}
