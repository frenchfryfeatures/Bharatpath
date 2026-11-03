import type { Faq } from "@/content/faq";

/** Filled tiles; one open at a time through the shared `name`. */
export function FaqList({ items, heading = "Questions, answered", group = "faq" }: { items: Faq[]; heading?: string; group?: string }) {
  return (
    <section aria-labelledby={`${group}-heading`} className="mx-auto max-w-[1240px] px-4 py-24 sm:px-6 lg:px-10">
      <div className="grid gap-8 lg:grid-cols-12">
        <h2 id={`${group}-heading`} className="text-[36px] font-semibold leading-[1.05] tracking-[-0.03em] lg:sticky lg:top-24 lg:col-span-4 lg:self-start lg:text-[clamp(36px,3.6vw,52px)]">
          {heading}
        </h2>
        <div className="space-y-2 lg:col-span-8">
          {items.map((f) => (
            <details key={f.q} name={group} className="faq-tile group rounded-[6px] bg-surface transition-colors open:bg-navy open:text-on-navy">
              <summary className="flex min-h-[68px] items-center justify-between gap-6 px-5 py-4 sm:px-6">
                <span className="text-[18px] font-medium leading-snug sm:text-[19px]">{f.q}</span>
                <span className="relative h-4 w-4 shrink-0" aria-hidden="true">
                  <span className="absolute left-0 top-[6.5px] h-[3px] w-4 rounded-full bg-current" />
                  <span className="plus-v absolute left-0 top-[6.5px] h-[3px] w-4 rotate-90 rounded-full bg-current group-open:rotate-0" />
                </span>
              </summary>
              <p className="max-w-[60ch] px-5 pb-6 text-[16px] leading-relaxed text-on-navy-muted sm:px-6">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
