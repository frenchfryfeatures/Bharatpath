import Link from "next/link";

export function Logo({ tone = "ink" }: { tone?: "ink" | "light" }) {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5" aria-label="BharatPath home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="" width={34} height={29} className="h-[29px] w-[34px]" />
      <span className={`text-[19px] font-semibold tracking-[-0.02em] ${tone === "light" ? "text-on-navy" : "text-ink"}`}>
        Bharat<span className={tone === "light" ? "text-saffron" : "text-navy"}>Path</span>
      </span>
    </Link>
  );
}
