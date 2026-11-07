import type { Faq } from "@/content/faq";

/** One open at a time through the shared `name`. */
export function FaqList({ items, heading = "Questions, answered", group = "faq" }: { items: Faq[]; heading?: string; group?: string }) {
  return (
    <section aria-labelledby={`${group}-heading`} className="shell py-20 sm:py-24">
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-4">
          <h2 id={`${group}-heading`} className="text-[28px] font-bold leading-[1.1] tracking-[-0.03em] sm:text-[36px] lg:sticky lg:top-28">
            {heading}
          </h2>
        </div>
        <div className="space-y-3 lg:col-span-8">
          {items.map((f) => (
            <details key={f.q} name={group} className="faq-item group rounded-[20px] border border-line bg-paper shadow-card transition-colors open:border-lilac-line open:bg-lavender">
              <summary className="flex min-h-[68px] items-center justify-between gap-6 px-5 py-4 sm:px-6">
                <span className="text-[17px] font-semibold leading-snug sm:text-[18px]">{f.q}</span>
                <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sand group-open:bg-purple group-open:text-white" aria-hidden="true">
                  <span className="absolute h-[2px] w-3.5 rounded-full bg-current" />
                  <span className="plus-v absolute h-[2px] w-3.5 rotate-90 rounded-full bg-current" />
                </span>
              </summary>
              <p className="max-w-[64ch] px-5 pb-6 text-[16px] leading-relaxed text-body sm:px-6">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
