/** One narrow module: a small exact demonstration, and two short paragraphs hung from its top edge. */
export function FeatureModule({ demo, title, children }: { demo: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div data-reveal className="grid max-w-[720px] gap-5 sm:grid-cols-[360px_1fr] sm:gap-6">
      <div className="flex min-h-[120px] items-center overflow-hidden rounded-[6px] bg-surface p-4">{demo}</div>
      <div>
        <h3 className="text-[18px] font-medium leading-snug">{title}</h3>
        <div className="mt-2 space-y-2 text-[15px] leading-relaxed text-muted">{children}</div>
      </div>
    </div>
  );
}

export function FeatureList({ heading, children, id }: { heading: string; children: React.ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="mx-auto max-w-[1240px] px-4 py-24 sm:px-6 lg:px-10">
      <div className="lg:pl-[12%]">
        <h2 id={id} className="text-[26px] font-semibold tracking-[-0.02em]">
          {heading}
        </h2>
        <div className="mt-14 space-y-20 lg:space-y-24">{children}</div>
      </div>
    </section>
  );
}
