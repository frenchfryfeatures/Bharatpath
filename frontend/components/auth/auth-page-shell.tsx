import Link from "next/link";
import { BrandIcon } from "@/components/common/brand-icon";
import {
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";

interface AuthPageShellProps {
  eyebrow: string;
  title: string;
  description: string;
  alternateText?: string;
  alternateLabel?: string;
  alternateHref?: string;
  children: React.ReactNode;
}

const benefits = [
  "One account for your BharatPath journey",
  "Secure, token-based access",
  "Role-specific candidate and partner portals",
];

export function AuthPageShell({
  eyebrow,
  title,
  description,
  alternateText,
  alternateLabel,
  alternateHref,
  children,
}: Readonly<AuthPageShellProps>) {
  return (
    <main className="min-h-screen bg-[#f4f7fb] lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(520px,0.95fr)]">
      <section className="relative hidden overflow-hidden bg-[#101a2c] px-12 py-14 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          className="absolute inset-0 opacity-70"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(circle at 18% 18%, rgba(66, 112, 204, 0.55), transparent 32%), radial-gradient(circle at 82% 72%, rgba(49, 163, 140, 0.24), transparent 35%)",
          }}
        />

        <div className="relative flex items-center gap-3">
          <BrandIcon className="h-11 w-11" />
          <div>
            <p className="text-lg font-semibold tracking-tight">
              Bharat<span className="text-[#FF8A26]">Path</span>
            </p>
            <p className="text-xs text-white/60">
              Opportunity, made visible
            </p>
          </div>
        </div>

        <div className="relative max-w-xl">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/80">
            <ShieldCheck className="h-4 w-4" />
            Built for India&apos;s talent ecosystem
          </div>

          <h2 className="max-w-lg text-4xl font-semibold leading-[1.12] tracking-[-0.035em] xl:text-5xl">
            A clearer path from potential to opportunity.
          </h2>
          <p className="mt-5 max-w-lg text-base leading-7 text-white/65">
            Candidates, employers, and colleges can work
            together through a secure, focused platform.
          </p>

          <ul className="mt-9 space-y-4">
            {benefits.map((benefit) => (
              <li
                key={benefit}
                className="flex items-center gap-3 text-sm text-white/80"
              >
                <CheckCircle2 className="h-4 w-4 text-[#79d4bd]" />
                {benefit}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/45">
          Your credentials are handled through the configured
          Neon-backed authentication service.
        </p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10 lg:px-14">
        <div className="w-full max-w-[470px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandIcon className="h-10 w-10" />
            <p className="font-semibold text-[#17233a]">
              Bharat<span className="text-[#FF8A26]">Path</span>
            </p>
          </div>

          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#3566b8]">
            {eyebrow}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.025em] text-[#17233a]">
            {title}
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#687386]">
            {description}
          </p>

          <div className="mt-8 rounded-2xl border border-[#e1e6ee] bg-white p-6 shadow-[0_20px_55px_rgba(27,39,61,0.08)] sm:p-8">
            {children}
          </div>

          {alternateText && alternateLabel && alternateHref && (
            <p className="mt-6 text-center text-sm text-[#687386]">
              {alternateText}{" "}
              <Link
                href={alternateHref}
                className="inline-flex items-center gap-1 font-semibold text-[#3566b8] hover:text-[#254f96]"
              >
                {alternateLabel}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
