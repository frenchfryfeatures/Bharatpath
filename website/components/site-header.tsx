"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { Logo } from "@/components/logo";
import { NAV_LINKS } from "@/lib/site";

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => pathname === href || pathname?.startsWith(href);

  return (
    <header className="sticky top-0 z-40 bg-ground/95 backdrop-blur-[2px]">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-4 sm:px-6 lg:px-10">
        <Logo />

        <nav aria-label="Main" className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`text-[15px] transition-colors hover:text-ink ${isActive(l.href) ? "font-medium text-ink" : "text-muted"}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Link href="/login/" className="rounded-[6px] px-3.5 py-2 text-[15px] text-ink transition-colors hover:bg-surface">
            Sign in
          </Link>
          <Link
            href="/signup/"
            className="rounded-[6px] bg-navy px-4 py-2 text-[15px] font-medium text-on-navy transition-colors hover:bg-navy-deep"
          >
            Create account
          </Link>
        </div>

        <button
          type="button"
          className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-[6px] text-ink md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {open && (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-line bg-ground px-4 pb-6 pt-2 md:hidden">
          <ul>
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={() => setOpen(false)} className="block py-3 text-[18px] text-ink">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link href="/login/" onClick={() => setOpen(false)} className="rounded-[6px] bg-surface px-4 py-3 text-center text-[15px] font-medium text-ink">
              Sign in
            </Link>
            <Link href="/signup/" onClick={() => setOpen(false)} className="rounded-[6px] bg-navy px-4 py-3 text-center text-[15px] font-medium text-on-navy">
              Create account
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
