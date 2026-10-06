"use client";

import { useState } from "react";
import { OnboardingBackButton } from "@/components/common/onboarding-back-button";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileText,
  FileUp,
  Sparkles,
} from "lucide-react";

import { useGetStudentScoreScaleQuery } from "@/store/student";
import { ScoreBandBar } from "@/features/student/components";

import {
  FEATURED_LOCALE_COUNT,
  SCORE_CATEGORIES,
  SIGNUP_LOCALES,
  type SignupLocale,
} from "../constants";
import { Card, DoneDot, PillButton, StepHeader } from "./ui";

/* -------------------------------------------------------------------------
 * 01b Value props
 * ---------------------------------------------------------------------- */
export function WelcomeStep({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-col gap-8">
      <div className="lg:hidden">
        <ResumeHero />
      </div>

      <div className="flex flex-col gap-3">
        <span className="w-fit rounded-full bg-[#F1EAF7] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#4A3E8F]">
          Free for every candidate
        </span>
        <h1 className="m-0 text-[34px] font-extrabold leading-[38px] tracking-[-0.03em] text-[#0A1931] sm:text-[44px] sm:leading-[48px]">
          Find out how strong your resume is!
        </h1>
        <p className="m-0 max-w-[480px] text-[16px] leading-[24px] text-[#3A4761]">
          Get a score that shows how your resume stands out to recruiters and
          where you can improve.
        </p>
      </div>

      <div className="flex max-w-[420px] flex-col gap-2.5">
        <PillButton onClick={onStart} className="w-full py-[18px]">
          Get started free
        </PillButton>
        <Link
          href="/login"
          className="rounded-full px-4 py-2.5 text-center text-[14px] font-medium text-[#3A4761] transition hover:text-[#0A1931]"
        >
          I already have an account
        </Link>
      </div>

      <ul className="grid max-w-[520px] grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { icon: <FileUp className="h-4 w-4" />, text: "Upload, paste or fill a form" },
          { icon: <ClipboardCheck className="h-4 w-4" />, text: "You check everything first" },
          { icon: <Sparkles className="h-4 w-4" />, text: "Fixes worth the most points" },
        ].map((item) => (
          <li
            key={item.text}
            className="flex items-center gap-2.5 text-[13px] leading-[18px] text-[#3A4761]"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EAF7] text-[#5F4DB2]">
              {item.icon}
            </span>
            {item.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The welcome illustration: a resume being read into the five categories.
 * Deliberately no dial or gauge - the score is never drawn as one.
 */
export function ResumeHero() {
  const scale = useGetStudentScoreScaleQuery();

  return (
    <div className="relative mx-auto w-full max-w-[380px] py-4" aria-hidden="true">
      <div className="absolute -left-4 top-10 h-40 w-40 rounded-full bg-[#F1EAF7] blur-2xl" />
      <div className="absolute -right-6 bottom-6 h-36 w-36 rounded-full bg-[#F7EFD6] blur-2xl" />

      <Card className="relative rotate-[-2deg] p-5 shadow-[0_24px_60px_-28px_rgba(10,25,49,0.35)]">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-[#E7E3F6]">
            <FileText className="h-5 w-5 text-[#5E4DB2]" />
          </span>
          <div className="flex flex-1 flex-col gap-1.5">
            <span className="h-2.5 w-2/3 rounded-full bg-[#0A1931]/80" />
            <span className="h-2 w-1/2 rounded-full bg-[#E7E0D4]" />
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-2">
          {[92, 78, 85, 64].map((width) => (
            <span
              key={width}
              className="h-2 rounded-full bg-[#F0EBDF]"
              style={{ width: `${width}%` }}
            />
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {SCORE_CATEGORIES.map((category, index) => (
            <span
              key={category}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold ${
                index < 3 ? "bg-[#E6F1EA] text-[#1F6B45]" : "bg-[#F7EFD6] text-[#7A5C0E]"
              }`}
            >
              {index < 3 ? <Check className="h-3 w-3" /> : null}
              {category}
            </span>
          ))}
        </div>
      </Card>

      <div className="relative -mt-6 ml-auto w-[240px] rotate-[3deg] rounded-[20px] bg-[#5F4DB2] p-4 text-white shadow-[0_24px_50px_-24px_rgba(95,77,178,0.8)]">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#E0DBF4]">
          Your score
        </span>
        {scale.data ? (
          <>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-[28px] font-extrabold leading-8 tracking-[-0.045em]">
                {scale.data.lowest}–{scale.data.highest}
              </span>
            </div>
            <span className="mb-2 mt-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#F1EAF7]">
              {scale.data.bands.length} bands
            </span>
            <ScoreBandBar scale={scale.data} band={null} />
          </>
        ) : (
          <span className="mt-1 block text-[15px] font-bold leading-5">
            One score and one band, from your confirmed resume.
          </span>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * 02 Language
 * ---------------------------------------------------------------------- */
interface LanguageStepProps {
  value: SignupLocale["code"] | null;
  onPick: (code: SignupLocale["code"]) => void;
  onBack?: () => void;
}

export function LanguageStep({ value, onPick, onBack }: Readonly<LanguageStepProps>) {
  const selectedIsHidden =
    value !== null &&
    SIGNUP_LOCALES.findIndex((locale) => locale.code === value) >= FEATURED_LOCALE_COUNT;
  const [showAll, setShowAll] = useState(selectedIsHidden);
  const visible = showAll ? SIGNUP_LOCALES : SIGNUP_LOCALES.slice(0, FEATURED_LOCALE_COUNT);
  const hiddenCount = SIGNUP_LOCALES.length - FEATURED_LOCALE_COUNT;

  return (
    <div className="flex flex-col gap-6">
      <StepHeader
        title="Pick your language"
        subtitle="Change it any time from your profile."
      />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="Languages">
        {visible.map((locale) => {
          const selected = value === locale.code;

          return (
            <button
              key={locale.code}
              type="button"
              aria-pressed={selected}
              onClick={() => onPick(locale.code)}
              className={`flex cursor-pointer items-center gap-3 rounded-[16px] border bg-white px-5 py-4 text-left transition hover:border-[#5F4DB2] ${
                selected ? "border-[#5F4DB2] ring-2 ring-[#5F4DB2]/15" : "border-[#E7E0D4]"
              }`}
            >
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="text-[17px] font-semibold leading-6 text-[#0A1931]">
                  {locale.native}
                </span>
                {locale.native !== locale.english && (
                  <span className="text-[13px] leading-4 text-[#5F6B80]">{locale.english}</span>
                )}
              </span>
              {selected ? (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#5F4DB2] text-white">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              ) : (
                <ChevronRight className="h-[18px] w-[18px] text-[#5F6B80]" aria-hidden="true" />
              )}
            </button>
          );
        })}

        {!showAll && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="flex cursor-pointer items-center gap-3 rounded-[16px] border border-[#E7E0D4] bg-white px-5 py-4 text-left transition hover:border-[#5F4DB2]"
          >
            <span className="flex-1 text-[17px] font-semibold leading-6 text-[#0A1931]">
              {hiddenCount} more languages
            </span>
            <ChevronDown className="h-[18px] w-[18px] text-[#5F6B80]" aria-hidden="true" />
          </button>
        )}
      </div>

      {onBack ? (
        <div className="flex gap-2">
          <OnboardingBackButton onClick={onBack} />
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * 03 How it works
 * ---------------------------------------------------------------------- */
const HOW_STEPS = [
  {
    title: "Give us your resume",
    body: "A file, pasted text, or fill a short form if you don't have one yet.",
    icon: FileUp,
  },
  {
    title: "Check what we read",
    body: "You correct anything wrong before it counts. Nothing is scored behind your back.",
    icon: ClipboardCheck,
  },
  {
    title: "Get your score and gaps",
    body: "Five categories, each explained, with the fixes worth the most points.",
    icon: Sparkles,
  },
] as const;

const ORDINALS = ["Step one", "Step two", "Step three"];

export function HowItWorksStep({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <StepHeader
        title="Three steps, that's all"
        subtitle="Give us your resume, check what we read, then see your score."
      />

      <div className="flex flex-col gap-3">
        {HOW_STEPS.map((step, index) => {
          const Icon = step.icon;

          return (
            <Card key={step.title} className="flex items-center gap-4 py-[18px] pl-5 pr-[18px]">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="flex items-center gap-2">
                  <span className="grid h-[22px] w-[22px] flex-none place-items-center rounded-full bg-[#5F4DB2] text-[11px] font-bold text-[#FFFCF7]">
                    {index + 1}
                  </span>
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#566073]">
                    {ORDINALS[index]}
                  </span>
                </span>
                <span className="text-[18px] font-bold leading-[23px] tracking-[-0.02em] text-[#0A1931]">
                  {step.title}
                </span>
                <span className="text-[13px] leading-[19px] text-[#3A4761]">{step.body}</span>
              </div>
              <span className="grid h-[72px] w-[72px] flex-none place-items-center rounded-[20px] bg-[#F1EAF7]">
                <Icon className="h-8 w-8 text-[#5F4DB2]" aria-hidden="true" />
              </span>
            </Card>
          );
        })}
      </div>

      <div className="flex items-center gap-3 rounded-[16px] bg-[#F7F4EC] px-4 py-3 text-[13px] text-[#3A4761]">
        <DoneDot />
        Takes about three minutes. You can stop and come back.
      </div>

      <div className="flex gap-2">
        <OnboardingBackButton onClick={onBack} />
        <PillButton onClick={onNext} className="flex-[2]">
          Got it
        </PillButton>
      </div>
    </div>
  );
}
