import { Check } from "lucide-react";

/**
 * Capability cards: each workflow step or capability is framed in its own
 * elevated card with a step badge, headline, body, bullet highlights, and a
 * contrasting preview stage. Rows alternate visual side on desktop for rhythm.
 */
export function SplitRow({
  step,
  eyebrow,
  title,
  body,
  points,
  fragment,
  stage = "lavender",
  flip = false,
}: {
  step?: string;
  eyebrow?: string;
  title: string;
  body: string;
  points?: string[];
  fragment: React.ReactNode;
  stage?: "lavender" | "purple" | "gold" | "sand";
  flip?: boolean;
}) {
  const s = {
    lavender: "bg-lavender border-lilac-line/60",
    purple: "bg-purple border-purple-deep",
    gold: "bg-gold-soft border-[#efe0b0]",
    sand: "bg-sand border-line",
  }[stage];

  const badgeTone = {
    lavender: "bg-lavender text-purple-deep",
    purple: "bg-purple text-white",
    gold: "bg-gold-soft text-gold-ink",
    sand: "bg-sand text-body",
  }[stage];

  return (
    <li
      data-reveal
      className="group rounded-[24px] border border-line bg-paper p-4 shadow-card transition-shadow duration-200 hover:shadow-lift sm:rounded-[28px] sm:p-8 lg:p-10"
    >
      <div className="grid items-center gap-6 sm:gap-8 lg:grid-cols-12 lg:gap-12">
        <div className={`min-w-0 lg:col-span-6 ${flip ? "lg:order-2" : ""}`}>
          {(step || eyebrow) && (
            <div className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4">
              {step && (
                <span className={`inline-flex items-center rounded-full px-3 py-1 text-[12px] font-bold uppercase tracking-wider ${badgeTone}`}>
                  {step}
                </span>
              )}
              {eyebrow && (
                <span className="text-[13px] font-semibold text-muted">
                  {eyebrow}
                </span>
              )}
            </div>
          )}

          <h3 className="max-w-[24ch] text-[22px] font-bold leading-[1.14] tracking-[-0.03em] text-ink sm:text-[30px]">
            {title}
          </h3>
          <p className="mt-3 max-w-[50ch] text-[15px] leading-relaxed text-body sm:mt-3.5 sm:text-[17px]">
            {body}
          </p>

          {points && points.length > 0 && (
            <ul className="mt-5 grid gap-2.5 border-t border-line pt-5 sm:grid-cols-2">
              {points.map((pt) => (
                <li key={pt} className="flex items-start gap-2.5 text-[14px] font-medium text-ink">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-green-soft text-green">
                    <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                  </span>
                  <span className="leading-snug">{pt}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div
          className={`flex min-h-[240px] min-w-0 items-center justify-center rounded-[18px] border p-3.5 sm:min-h-[320px] sm:rounded-[22px] sm:p-8 lg:col-span-6 ${s} ${
            flip ? "lg:order-1" : ""
          }`}
        >
          {fragment}
        </div>
      </div>
    </li>
  );
}

export function SplitRows({
  heading,
  lead,
  eyebrow,
  id,
  children,
}: {
  heading: string;
  lead?: string;
  eyebrow?: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="shell py-16 sm:py-24">
      <div className="mb-10 max-w-[680px] sm:mb-14">
        {eyebrow && (
          <span className="mb-3 inline-flex rounded-full bg-lavender px-3.5 py-1 text-[13px] font-semibold text-purple-deep">
            {eyebrow}
          </span>
        )}
        <h2 id={id} className="text-[30px] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[40px]">
          {heading}
        </h2>
        {lead && <p className="mt-3.5 text-[17px] leading-relaxed text-muted">{lead}</p>}
      </div>
      <ol className="space-y-6 sm:space-y-8">{children}</ol>
    </section>
  );
}
