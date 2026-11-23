"use client";

/**
 * Add-ons (2026-11-23): every way to earn a reward, as tiles -- the web twin
 * of the app's Add-ons screen. Add a tile by adding an entry to `ADD_ONS`.
 *
 * A skill course and a mock interview add to the Bharatpath Score;
 * daily-streak points are a separate balance that never reaches the score
 * (docs/streaks.md), so that tile must not say otherwise. No tile states a
 * number of points: the score is never explained (R11).
 */
import Link from "next/link";
import { ArrowLeft, BookOpen, ChevronRight, Flame, Mic2, type LucideIcon } from "lucide-react";

import { StudentPage } from "@/features/student/shell";

interface AddOnTile {
  key: string;
  title: string;
  description: string;
  reward: string;
  href: string;
  icon: LucideIcon;
  tint: string;
  iconColor: string;
}

const ADD_ONS: AddOnTile[] = [
  {
    key: "courses",
    title: "Skill courses",
    description: "Short certified courses you can finish at your own pace.",
    reward: "Adds to your Bharatpath Score",
    href: "/student/courses",
    icon: BookOpen,
    tint: "bg-[#E8EEF9]",
    iconColor: "text-[#2F5DA8]",
  },
  {
    key: "mock-interview",
    title: "Mock interview",
    description: "Practise answering interview questions and get feedback.",
    reward: "Adds to your Bharatpath Score",
    href: "/student/interview",
    icon: Mic2,
    tint: "bg-[#FDEBDD]",
    iconColor: "text-[#B4561C]",
  },
  {
    key: "streak",
    title: "Daily streak",
    description: "Log in every day to build your streak.",
    reward: "Earns streak points",
    href: "/student/streak",
    icon: Flame,
    tint: "bg-[#FFF1E0]",
    iconColor: "text-[#FF6B00]",
  },
];

export function AddOnsPage() {
  return (
    <StudentPage>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
        <Link
          href="/student/profile"
          className="flex w-fit items-center gap-2 rounded-xl text-sm font-medium text-[#5F4DB2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back to profile
        </Link>
        <div>
          <h1 className="text-[24px] font-semibold leading-[30px] tracking-[-0.3px] text-[#0A1931]">Add-ons</h1>
          <p className="mt-2 text-[14px] leading-[21px] text-[#5F6B80]">Ways to earn rewards on BharatPath.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {ADD_ONS.map(({ key, title, description, reward, href, icon: Icon, tint, iconColor }) => (
            <Link
              key={key}
              href={href}
              className="flex items-center gap-4 rounded-[20px] border border-[#E7E0D4] bg-white p-4 transition hover:border-[#C9BEEB] hover:bg-[#FCFAFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30"
            >
              <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-[14px] ${tint}`}>
                <Icon size={22} className={iconColor} aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[15px] font-semibold text-[#0A1931]">{title}</span>
                <span className="text-[13px] leading-5 text-[#5F6B80]">{description}</span>
                <span className="mt-1 w-fit rounded-full bg-[#F1EAF7] px-2.5 py-1 text-[11px] font-semibold text-[#4A3E8F]">
                  {reward}
                </span>
              </span>
              <ChevronRight size={18} className="text-[#5F6B80]" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </div>
    </StudentPage>
  );
}
