import { Loader2, ShieldCheck } from "lucide-react";

import { BrandIcon } from "@/components/common/brand-icon";
import { PORTAL_TYPES, type PortalType } from "@/config/portal";

const portalAppearance = {
  [PORTAL_TYPES.STUDENT]: {
    name: "Student",
    background: "bg-[#FFFCF7]",
    foreground: "text-[#0A1931]",
    muted: "text-[#3A4761]",
    accent: "text-[#5F4DB2]",
    logoBackground: "",
  },
  [PORTAL_TYPES.EMPLOYER]: {
    name: "Employer",
    background: "bg-[#f7f8fa]",
    foreground: "text-[#151b2b]",
    muted: "text-[#5d6673]",
    accent: "text-[#3566b8]",
    logoBackground: "",
  },
  [PORTAL_TYPES.COLLEGE]: {
    name: "College",
    background: "bg-[#f8f7ff]",
    foreground: "text-[#242044]",
    muted: "text-[#625d7d]",
    accent: "text-[#5b4fcf]",
    logoBackground: "",
  },
  [PORTAL_TYPES.ADMIN]: {
    name: "Admin",
    background: "bg-[#f7f8fa]",
    foreground: "text-[#172033]",
    muted: "text-[#687182]",
    accent: "text-[#5b4fcf]",
    logoBackground: "",
  },
} as const;

function PortalAnimation({ portal }: { readonly portal: PortalType }) {
  switch (portal) {
    case PORTAL_TYPES.EMPLOYER:
      return (
        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-[#dce7f7]" aria-hidden="true">
          <div className="h-full w-1/3 rounded-full bg-[#3566b8] animate-[bpSweep_1.6s_ease-in-out_infinite] motion-reduce:animate-none" />
        </div>
      );
    case PORTAL_TYPES.COLLEGE:
      return (
        <div className="flex h-8 items-center gap-2" aria-hidden="true">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#5b4fcf] motion-reduce:animate-none"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      );
    case PORTAL_TYPES.ADMIN:
      return (
        <div className="relative grid h-10 w-10 place-items-center" aria-hidden="true">
          <span className="absolute inset-0 animate-ping rounded-full border border-[#5b4fcf]/50 motion-reduce:animate-none" />
          <span className="absolute inset-1 rounded-full border border-[#5b4fcf]/30" />
          <ShieldCheck className="relative h-5 w-5 text-[#5b4fcf]" />
        </div>
      );
    default:
      return (
        <Loader2
          className="h-8 w-8 animate-spin text-[#5F4DB2] motion-reduce:animate-none"
          aria-hidden="true"
        />
      );
  }
}

export function AccountDestinationLoading({
  portal = PORTAL_TYPES.STUDENT,
  message = "Checking your account…",
}: {
  readonly portal?: PortalType;
  readonly message?: string;
}) {
  const appearance = portalAppearance[portal];

  return (
    <main
      role="status"
      aria-live="polite"
      className={`flex min-h-screen items-center justify-center px-6 ${appearance.background} ${appearance.foreground}`}
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <BrandIcon className={`h-12 w-12 ${appearance.logoBackground}`} />
        {portal !== PORTAL_TYPES.STUDENT && (
          <p className={`text-xs font-bold uppercase tracking-[0.16em] ${appearance.accent}`}>
            {appearance.name} portal
          </p>
        )}
        <PortalAnimation portal={portal} />
        <p className={`text-sm font-medium ${appearance.muted}`}>{message}</p>
      </div>
    </main>
  );
}
