import Link from "next/link";

export default function NotFound() {
  return (
    <section className="mx-auto max-w-[1240px] px-4 pb-10 pt-20 sm:px-6 lg:px-10">
      <h1 className="text-[clamp(40px,5.6vw,80px)] font-semibold leading-[1] tracking-[-0.045em]">This path ends here.</h1>
      <p className="mt-5 max-w-[48ch] text-[17px] text-muted">The page you were looking for has moved or never existed.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/" className="rounded-[6px] bg-navy px-5 py-3 text-[15px] font-medium text-on-navy hover:bg-navy-deep">
          Go home
        </Link>
        <Link href="/jobs/" className="rounded-[6px] px-4 py-3 text-[15px] font-medium hover:bg-surface">
          Browse jobs
        </Link>
      </div>
    </section>
  );
}
