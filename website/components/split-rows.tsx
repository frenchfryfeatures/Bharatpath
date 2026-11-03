/**
 * Capability rows on a 5/7 split: a two-line statement and the fragment that
 * proves it. Fragments vary in size, so the column never becomes a zigzag.
 */
export function SplitRow({ title, body, fragment, stage = "surface" }: { title: string; body: string; fragment: React.ReactNode; stage?: "surface" | "navy" }) {
  return (
    <div data-reveal className="grid gap-6 lg:grid-cols-12 lg:items-center lg:gap-8">
      <div className="lg:col-span-5">
        <h3 className="max-w-[22ch] text-[24px] font-semibold leading-tight tracking-[-0.02em] sm:text-[30px]">{title}</h3>
        <p className="mt-3 max-w-[44ch] text-muted">{body}</p>
      </div>
      <div className={`flex justify-center rounded-[6px] p-6 sm:p-10 lg:col-span-7 ${stage === "navy" ? "bg-navy" : "bg-surface"}`}>{fragment}</div>
    </div>
  );
}

export function SplitRows({ heading, id, children }: { heading: string; id: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mx-auto max-w-[1240px] px-4 py-24 sm:px-6 lg:px-10">
      <h2 id={id} className="text-[26px] font-semibold tracking-[-0.02em]">
        {heading}
      </h2>
      <div className="mt-12 space-y-16 lg:space-y-24">{children}</div>
    </section>
  );
}
