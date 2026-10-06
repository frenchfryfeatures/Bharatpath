"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { BrandIcon } from "@/components/common/brand-icon";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { useScrollLock } from "@/hooks/use-scroll-lock";

const navigation = [
  ["Dashboard", "/admin/dashboard"],
  ["Queue", "/admin/queue"],
  ["Users", "/admin/users"],
  ["Disputes", "/admin/disputes"],
  ["Audit trail", "/admin/audit"],
  ["Attributes", "/admin/search-filters"],
  ["Discount codes", "/admin/discount-codes"],
  ["Settings", "/admin/settings"],
] as const;

export function AdminShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-[#141b2e]">
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-[#e5e8ee] bg-white p-5 lg:block">
        <Link href="/admin/dashboard" className="flex items-center gap-2 text-base font-bold text-[#385da8]">
          <BrandIcon className="h-8 w-8" />
          BharatPath Admin
        </Link>
        <nav className="mt-8 space-y-1">
          {navigation.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className={`block rounded-lg px-3 py-2 text-sm font-semibold ${pathname === href ? "bg-[#eef0ff] text-[#385da8]" : "text-[#687182] hover:bg-[#f5f6f8]"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="min-h-screen lg:pl-60">{children}</main>
    </div>
  );
}

export function AdminPage({
  title,
  subtitle,
  children,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-[#7b8494]">{subtitle}</p>
      </header>
      {children}
    </div>
  );
}

export function Drawer({
  open,
  title,
  onClose,
  children,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  useScrollLock(open);

  if (!open) return null;

  return (
    <div data-scroll-lock-root className="fixed inset-0 z-50 flex justify-end bg-[#141b2e]/30" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close drawer" onClick={onClose} />
      <section className="relative h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-[#687182] hover:bg-[#f5f6f8]" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
