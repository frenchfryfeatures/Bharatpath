"use client";

import {
  BriefcaseBusiness,
  MapPin,
  Star,
} from "lucide-react";

import type { Candidate } from "./types";

interface CandidateCardProps {
  candidate: Candidate;
  onReveal?: () => void;
}

/* =========================================================
   SKILL PILL
   ========================================================= */

function SkillPill({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <span className="rounded-full bg-[#f2f4f7] px-[9px] py-[4px] text-[11px] font-medium leading-[14px] text-[#273142]">
      {children}
    </span>
  );
}

/* =========================================================
   CANDIDATE CARD
   ========================================================= */

export function CandidateCard({
  candidate,
  onReveal,
}: CandidateCardProps) {
  const bandLabels = {
    ENTRY: "Entry",
    DEVELOPING: "Developing",
    SOLID: "Solid",
    STRONG: "Strong",
  } as const;
  const band = bandLabels[candidate.band];

  /*
   * Reference uses:
   *
   * var(--ink-muted)
   * var(--green-ink)
   * var(--indigo-ink)
   *
   * We map those values here so the card remains visually
   * identical without depending on global CSS variables.
   */

  const bandBackground =
    band === "Strong"
      ? "#5b4fcf"
      : band === "Solid"
        ? "#217653"
        : "#6c7684";

  /*
   * Avatar background follows the reference:
   *
   * Building     -> tint
   * Strong       -> green-bg
   * Exceptional  -> indigo-bg
   */

  const avatarBackground =
    band === "Strong"
      ? "#eeecff"
      : band === "Solid"
        ? "#e8f5ef"
        : "#f2f4f7";

  const avatarIconColor =
    band === "Strong"
      ? "#5b4fcf"
      : band === "Solid"
        ? "#217653"
        : "#6c7684";

  /*
   * Show first 5 skills, exactly like the reference.
   */
  const visibleSkills = candidate.skills.slice(0, 5);

  const remainingSkills =
    Math.max(candidate.skills.length - 5, 0);

  const displayName =
    candidate.fullName ?? "Name not shared";
  const initials = candidate.fullName
    ? candidate.fullName
        .split(" ")
        .filter(Boolean)
        .map((word) => word[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "C";

  return (
    <article
      className="
        flex
        items-start
        gap-[16px]
        rounded-[12px]
        border
        border-[#e3e7eb]
        bg-white
        p-[16px]
        shadow-[0_2px_4px_rgba(19,26,38,0.04),0_8px_20px_rgba(19,26,38,0.05)]
      "
    >
      <span
        className="
          grid
          h-[44px]
          w-[44px]
          shrink-0
          place-items-center
          rounded-[12px]
        "
        style={{
          backgroundColor: avatarBackground,
        }}
      >
        <span
          className="text-[13px] font-bold leading-none"
          style={{ color: avatarIconColor }}
        >
          {initials}
        </span>
      </span>

      {/* =====================================================
          CANDIDATE CONTENT
          ===================================================== */}

      <span
        className="
          flex
          min-w-0
          flex-1
          flex-col
          gap-[8px]
        "
      >
        {/* -------------------------------------------------
            NAME + SCORE
            ------------------------------------------------- */}

        <span
          className="
            flex
            flex-wrap
            items-center
            gap-[8px]
          "
        >
          {/* Candidate name */}
          <span
            className="
              min-w-0
              overflow-hidden
              text-ellipsis
              whitespace-nowrap
              text-[14px]
              font-semibold
              leading-[18px]
              text-[#202a3b]
            "
          >
            {displayName}
          </span>

          {/* Score band */}
          <span
            className="
              flex
              h-[22px]
              shrink-0
              items-center
              gap-[5px]
              whitespace-nowrap
              rounded-full
              px-[8px]
              text-[11px]
              font-semibold
              leading-[14px]
              text-white
            "
            style={{
              backgroundColor: bandBackground,
            }}
          >
            <Star
              size={12}
              strokeWidth={0}
              fill="currentColor"
            />

            <span>{band}</span>
          </span>

        </span>

        {/* -------------------------------------------------
            CONTACT (shown once revealed)
            ------------------------------------------------- */}
        {(candidate.phone || candidate.email) && (
          <span className="flex flex-wrap items-center gap-x-[12px] gap-y-[2px] text-[12px] leading-[17px] text-[#4a5568]">
            {candidate.phone && <span>{candidate.phone}</span>}
            {candidate.email && <span>{candidate.email}</span>}
          </span>
        )}

        {/* -------------------------------------------------
            LOCATION / EXPERIENCE / SALARY
            ------------------------------------------------- */}

        <span
          className="
            flex
            flex-wrap
            items-center
            gap-x-[8px]
            gap-y-[4px]
          "
        >
          {/* Location */}
          <span
            className="
              flex
              items-center
              gap-[6px]
              text-[12px]
              font-normal
              leading-[17px]
              text-[#6c7684]
            "
          >
            <MapPin
              size={14}
              strokeWidth={2}
            />

            <span>{candidate.location.trim() || "Location not provided"}</span>
          </span>

          {/* Experience */}
          <span
            className="
              flex
              items-center
              gap-[6px]
              text-[12px]
              font-normal
              leading-[17px]
              text-[#6c7684]
            "
          >
            <BriefcaseBusiness
              size={14}
              strokeWidth={2}
            />

            <span>
              {candidate.experienceYears}{" "}
              {candidate.experienceYears === 1
                ? "yr"
                : "yrs"}{" "}
              exp
            </span>
          </span>

        </span>

        {/* -------------------------------------------------
            SKILLS
            ------------------------------------------------- */}

        <span
          className="
            flex
            flex-wrap
            items-center
            gap-[6px]
          "
        >
          {visibleSkills.length > 0 ? (
            visibleSkills.map((skill) => (
              <SkillPill key={skill}>
                {skill}
              </SkillPill>
            ))
          ) : (
            <span className="text-[11px] text-[#8a92a0]">
              No skills provided
            </span>
          )}

          {remainingSkills > 0 && (
            <span
              className="
                px-[2px]
                py-[4px]
                text-[11px]
                font-medium
                leading-[14px]
                text-[#6c7684]
              "
            >
              +{remainingSkills} more
            </span>
          )}
        </span>
      </span>

      {onReveal && <button type="button" onClick={onReveal} className="ml-auto shrink-0 rounded-lg bg-[#5b4fcf] px-3 py-2 text-xs font-semibold text-white">Open profile</button>}
    </article>
  );
}
