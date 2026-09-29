"use client";

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { LucideIcon } from "lucide-react";

export interface HeaderBadge {
  icon?: LucideIcon;
  label: string;
}

export interface Breadcrumb {
  label: string;
  href?: string;
  /** Render a skeleton in place of the label while it is still loading. */
  isLoading?: boolean;
}

export interface HeaderStat {
  icon?: LucideIcon;
  label: string;
  sublabel?: string;
  /** 0-100. Omit to hide the progress bar. */
  progress?: number;
  isLoading?: boolean;
}

interface HeaderContent {
  title: string;
  subtitle: string;
  breadcrumbs?: Breadcrumb[];
  badge?: HeaderBadge;
  stat?: HeaderStat;
  action?: ReactNode;
}

interface HeaderContextValue extends HeaderContent {
  setHeader: (content: HeaderContent) => void;
}

const HeaderContext =
  createContext<HeaderContextValue | null>(null);

export function HeaderProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [content, setContent] =
    useState<HeaderContent>({
      title: "",
      subtitle: "",
    });

  const value = useMemo(
    () => ({
      ...content,
      setHeader: setContent,
    }),
    [content],
  );

  return (
    <HeaderContext.Provider value={value}>
      {children}
    </HeaderContext.Provider>
  );
}

export function useHeaderContent() {
  const context = useContext(HeaderContext);

  if (!context) {
    throw new Error(
      "useHeaderContent must be used within a HeaderProvider",
    );
  }

  return context;
}

export interface PageHeaderOptions {
  breadcrumbs?: Breadcrumb[];
  badge?: HeaderBadge;
  stat?: HeaderStat;
  action?: ReactNode;
}

export function usePageHeader(
  title: string,
  subtitle: string,
  options?: PageHeaderOptions,
) {
  const { setHeader } = useHeaderContent();
  const { breadcrumbs, badge, stat, action } = options ?? {};

  // Icons are stable component references, so they're left out of the
  // dependency string below and only the data fields are compared.
  const badgeKey = badge ? JSON.stringify(badge.label) : "";
  const statKey = stat
    ? JSON.stringify([
        stat.label,
        stat.sublabel,
        stat.progress,
        stat.isLoading,
      ])
    : "";
  const breadcrumbsKey = breadcrumbs
    ? JSON.stringify(breadcrumbs)
    : "";

  useEffect(() => {
    setHeader({ title, subtitle, breadcrumbs, badge, stat, action });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, subtitle, setHeader, badgeKey, statKey, action, breadcrumbsKey]);
}
