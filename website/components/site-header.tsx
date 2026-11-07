"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { Logo } from "@/components/logo";
import { buttonClass } from "@/components/ui";
import { NAV_LINKS } from "@/lib/site";

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const isActive = (href: string) => pathname === href || pathname?.startsWith(href);
  const close = () => setOpen(false);

  return (
    <header className={`sticky top-0 z-40 transition-[background,box-shadow] duration-200 ${scrolled || open ? "bg-cream/95 shadow-[0_1px_0_var(--color-line)] backdrop-blur-sm" : "bg-cream"}`}>
      <div className="shell flex h-[72px] items-center justify-between gap-6">
        <Logo />

        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? "page" : undefined}
              className={`rounded-full px-4 py-2 text-[15px] font-medium transition-colors ${
                isActive(l.href) ? "bg-lavender text-purple-deep" : "text-body hover:bg-sand hover:text-ink"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Link href="/login/" className={buttonClass("ghost")}>
            Sign in
          </Link>
          <Link href="/signup/" className={buttonClass("primary")}>
            Create account
          </Link>
        </div>

        <button
          type="button"
          className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-ink hover:bg-sand lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {open && (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-line bg-cream lg:hidden">
          <div className="shell pb-6 pt-3">
            <ul className="grid gap-1 sm:grid-cols-2">
              {NAV_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} onClick={close} className="block rounded-2xl px-4 py-3 text-[17px] font-medium text-ink hover:bg-sand">
                    {l.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/government-jobs/" onClick={close} className="block rounded-2xl px-4 py-3 text-[17px] font-medium text-ink hover:bg-sand">
                  Government jobs
                </Link>
              </li>
            </ul>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link href="/login/" onClick={close} className={buttonClass("secondary")}>
                Sign in
              </Link>
              <Link href="/signup/" onClick={close} className={buttonClass("primary")}>
                Create account
              </Link>
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}
