"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/** Search text belongs to the current page, including pages reused for tabs. */
export function usePageSearch(section = "") {
  const pathname = usePathname();
  const key = `${pathname}:${section}`;
  const [state, setState] = useState({ key, text: "" });

  if (state.key !== key) {
    setState({ key, text: "" });
  }

  // Next.js can retain a hidden page for back navigation. Clear its text
  // when its effects disconnect so returning to it starts a fresh search.
  useEffect(() => () => setState({ key, text: "" }), [key]);

  const setSearch = useCallback((text: string) => setState({ key, text }), [key]);
  return [state.key === key ? state.text : "", setSearch] as const;
}
