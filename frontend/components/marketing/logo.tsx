import Link from "next/link";

export function Logo({ tone = "ink" }: { tone?: "ink" | "light" }) {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5 rounded-lg" aria-label="BharatPath home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="" width={34} height={29} className="h-[29px] w-[34px]" />
      <span className={`text-[19px] font-bold tracking-[-0.03em] ${tone === "light" ? "text-white" : "text-ink"}`}>
        Bharat<span className={tone === "light" ? "text-gold" : "text-purple"}>Path</span>
      </span>
    </Link>
  );
}
