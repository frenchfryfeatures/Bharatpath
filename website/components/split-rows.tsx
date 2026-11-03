/**
 * Capability rows: a statement and the working piece of the product that
 * proves it, each in its own card. Stages alternate tint, never side.
 */
export function SplitRow({ title, body, fragment, stage = "lavender" }: { title: string; body: string; fragment: React.ReactNode; stage?: "lavender" | "purple" | "gold" | "sand" }) {
  const s = { lavender: "bg-lavender", purple: "bg-purple", gold: "bg-gold-soft", sand: "bg-sand" }[stage];
  return (
    <li data-reveal className="grid items-center gap-6 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
      <div className="min-w-0">
        <h3 className="max-w-[22ch] text-[24px] font-bold leading-tight tracking-[-0.03em] sm:text-[30px]">{title}</h3>
        <p className="mt-3 max-w-[46ch] text-[16px] text-muted sm:text-[17px]">{body}</p>
      </div>
      <div className={`flex min-h-[340px] min-w-0 items-center justify-center rounded-[22px] p-5 sm:p-10 ${s}`}>{fragment}</div>
    </li>
  );
}

export function SplitRows({ heading, lead, id, children }: { heading: string; lead?: string; id: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="shell py-16 sm:py-20">
      <div className="mb-10 max-w-[640px]">
        <h2 id={id} className="text-[28px] font-bold leading-[1.1] tracking-[-0.03em] sm:text-[36px]">
          {heading}
        </h2>
        {lead && <p className="mt-3 text-[17px] text-muted">{lead}</p>}
      </div>
      <ul className="space-y-14 sm:space-y-20">{children}</ul>
    </section>
  );
}
