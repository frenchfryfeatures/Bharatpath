"use client";

import { useEffect, useRef } from "react";

/**
 * Scrolls to the element named by the URL hash once `ready` is true.
 *
 * Next.js tries to scroll to a hash on navigation, but it does so before
 * data-driven content above the target has loaded, so the target moves once
 * skeletons are replaced. Waiting for `ready` lands on the final position.
 */
export function useScrollToHash(ready = true) {
  const scrolledHash = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) {
      return;
    }

    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (!hash || scrolledHash.current === hash) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(hash);
      if (!target) {
        return;
      }

      target.scrollIntoView({ behavior: "smooth", block: "start" });
      scrolledHash.current = hash;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [ready]);
}
