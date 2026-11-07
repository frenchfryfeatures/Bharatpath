import Link from "next/link";

/**
 * Shared primitives, in the student portal's language: pill buttons, tinted
 * cards, a section heading with an optional "see all" link.
 */

type Tone = "primary" | "secondary" | "ghost" | "light" | "gold";

const BUTTON: Record<Tone, string> = {
  primary: "bg-purple text-white shadow-purple hover:bg-purple-deep",
  secondary: "border border-line bg-paper text-ink hover:border-lilac-line hover:bg-sand",
  ghost: "text-ink hover:bg-sand",
  light: "bg-paper text-ink hover:bg-lavender",
  gold: "bg-gold text-ink hover:bg-[#efcb63]",
};

export function buttonClass(tone: Tone = "primary", size: "md" | "lg" = "md") {
  return `inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-150 active:scale-[.98] ${
    size === "lg" ? "min-h-[52px] px-6 text-[16px]" : "min-h-[44px] px-5 text-[15px]"
  } ${BUTTON[tone]}`;
}

export function ButtonLink({ href, tone = "primary", size = "md", children, className = "" }: { href: string; tone?: Tone; size?: "md" | "lg"; children: React.ReactNode; className?: string }) {
  const external = href.startsWith("http");
  if (external) {
    return (
      <a href={href} className={`${buttonClass(tone, size)} ${className}`}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={`${buttonClass(tone, size)} ${className}`}>
      {children}
    </Link>
  );
}

export function SectionHeading({ title, lead, action, id }: { title: string; lead?: string; action?: { href: string; label: string }; id?: string }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-[640px]">
        <h2 id={id} className="text-[28px] font-bold leading-[1.1] tracking-[-0.03em] sm:text-[36px] 2xl:text-[42px]">
          {title}
        </h2>
        {lead && <p className="mt-3 text-[16px] text-muted sm:text-[17px]">{lead}</p>}
      </div>
      {action && (
        <Link href={action.href} className="shrink-0 text-[15px] font-semibold text-purple hover:text-purple-deep hover:underline">
          {action.label} →
        </Link>
      )}
    </div>
  );
}

export function Chip({ children, tone = "sand" }: { children: React.ReactNode; tone?: "sand" | "lavender" | "gold" | "green" | "white" }) {
  const t = {
    sand: "bg-sand text-body",
    lavender: "bg-lavender text-purple-deep",
    gold: "bg-gold-soft text-gold-ink",
    green: "bg-green-soft text-green",
    white: "bg-paper text-body border border-line",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-semibold leading-none ${t}`}>{children}</span>;
}
