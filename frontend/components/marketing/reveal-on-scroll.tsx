"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Marks `[data-reveal]` blocks as they enter the viewport. The page is fully
 * visible without JavaScript: the hidden state only applies under `.js`.
 */
export function RevealOnScroll() {
  const pathname = usePathname();

  useEffect(() => {
    document.documentElement.classList.add("js");
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-in)"));
    if (!("IntersectionObserver" in window)) {
      nodes.forEach((n) => n.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [pathname]);

  return null;
}
