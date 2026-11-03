export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-[760px] px-4 pb-10 pt-14 sm:px-6 lg:pt-20">
      <h1 className="text-[clamp(36px,4.6vw,60px)] font-semibold leading-[1.02] tracking-[-0.04em]">{title}</h1>
      <p className="mt-3 text-[15px] text-muted">Last updated {updated}</p>
      <p className="mt-6 rounded-[6px] bg-saffron-soft px-4 py-3 text-[15px]">
        This is a plain-language summary prepared ahead of launch. The full policy is being finalised with legal counsel and will replace this page.
      </p>
      <div className="mt-10 space-y-8 text-[16px] leading-relaxed [&_h2]:mb-2 [&_h2]:text-[22px] [&_h2]:font-semibold [&_h2]:tracking-[-0.02em] [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_p]:text-muted [&_ul]:space-y-1.5 [&_ul]:text-muted">
        {children}
      </div>
    </article>
  );
}
