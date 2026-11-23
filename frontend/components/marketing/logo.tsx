import { BrandIcon } from "@/components/common/brand-icon";
import { BrandWordmark } from "@/components/common/brand-wordmark";
import Link from "next/link";

export function Logo({ tone = "ink" }: { tone?: "ink" | "light" }) {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5 rounded-lg" aria-label="BharatPath home">
      <BrandIcon className="h-[29px] w-[34px]" />
      <span className={`text-[19px] font-bold tracking-[-0.03em] ${tone === "light" ? "text-white" : "text-ink"}`}>
        <BrandWordmark light={tone === "light"} />
      </span>
    </Link>
  );
}
