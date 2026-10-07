import { Loader2 } from "lucide-react";

import { BrandIcon } from "@/components/common/brand-icon";

export function AccountDestinationLoading() {
  return (
    <main
      role="status"
      aria-live="polite"
      className="flex min-h-screen items-center justify-center bg-[#FFFCF7] px-6 text-[#0A1931]"
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <BrandIcon className="h-12 w-12" />
        <Loader2 className="h-8 w-8 animate-spin text-[#5F4DB2] motion-reduce:animate-none" aria-hidden="true" />
        <p className="text-sm font-medium text-[#3A4761]">Checking your account…</p>
      </div>
    </main>
  );
}
