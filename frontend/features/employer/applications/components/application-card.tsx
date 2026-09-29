"use client";

import {
  BriefcaseBusiness,
  MapPin,
  Star,
} from "lucide-react";

import type {
  EmployerApplication,
} from "../types";

interface ApplicationCardProps {
  application: EmployerApplication;
  onClick: () => void;
}

function getBand(score: number) {
  if (score >= 900) {
    return {
      label: "Exceptional",
      background: "#28578f",
      avatarBackground: "#edf3fb",
      avatarColor: "#28578f",
    };
  }

  if (score >= 800) {
    return {
      label: "Strong",
      background: "#16845d",
      avatarBackground: "#eaf7f1",
      avatarColor: "#16845d",
    };
  }

  /*
   * Reference UI uses the muted gray badge
   * for Building candidates.
   */
  return {
    label: "Building",
    background: "#646e7c",
    avatarBackground: "#f0f2f5",
    avatarColor: "#687384",
  };
}

export function ApplicationCard({
  application,
  onClick,
}: ApplicationCardProps) {
  const {
    candidate,
  } = application;

  const band =
    candidate.exactScore === null
      ? null
      : getBand(candidate.exactScore);

  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application-id", application.id);
      }}
      onClick={onClick}
      className="
        group
        flex
        w-full
        flex-col
        cursor-pointer
        active:cursor-grabbing
        rounded-[10px]
        border
        border-[#e1e5eb]
        bg-white
        p-3
        text-left
        shadow-[0_1px_2px_rgba(19,26,38,0.04)]
        transition
        hover:border-[#d4d9e1]
        hover:shadow-[0_4px_10px_rgba(19,26,38,0.07)]
        focus:outline-none
        focus:ring-2
        focus:ring-[#315f9b]/20
      "
      style={{
        gap: "8px",
        flex: "0 0 auto",
      }}
    >
      {/* =====================================================
          CANDIDATE HEADER
          Reference structure:

          <span>
            <span avatar />
            <span name />
            <span badge />
          </span>
          ===================================================== */}

      <span
        className="
          flex
          min-w-0
          items-center
          gap-2
        "
      >
        {/* AVATAR */}

        <span
          className="
            grid
            h-[26px]
            w-[26px]
            shrink-0
            place-items-center
            rounded-[8px]
          "
          style={{
            background:
              band?.avatarBackground ?? "#f0f2f5",
          }}
        >
          <span
            className="
              text-[11px]
              font-bold
              leading-none
            "
            style={{
              color:
                band?.avatarColor ?? "#687384",
            }}
          >
            {candidate.initials}
          </span>
        </span>

        {/* NAME */}

        <span
          className="
            min-w-0
            flex-1
            overflow-hidden
            text-ellipsis
            whitespace-nowrap
            text-[12px]
            font-semibold
            leading-[16px]
            text-[#252d3b]
          "
        >
          {candidate.name}
        </span>

        {/* BAND */}

        {band ? (
          <span
            className="
              inline-flex
              shrink-0
              items-center
              gap-1
              rounded-full
              px-2
              py-1
              text-[11px]
              font-semibold
              leading-[14px]
              text-white
            "
            style={{
              background:
                band.background,
            }}
          >
            <Star
              size={12}
              fill="currentColor"
              strokeWidth={1.5}
            />
            <span>
              {band.label}
            </span>
          </span>
        ) : null}
      </span>

      {/* =====================================================
          JOB
          ===================================================== */}

      <span
        className="
          flex
          min-w-0
          items-center
          gap-[6px]
          text-[11px]
          font-normal
          leading-[14px]
          text-[#687384]
        "
      >
        <BriefcaseBusiness
          size={12}
          className="shrink-0"
          strokeWidth={1.8}
        />

        <span
          className="
            min-w-0
            flex-1
            overflow-hidden
            text-ellipsis
            whitespace-nowrap
          "
        >
          {candidate.jobTitle}
        </span>
      </span>

      {/* =====================================================
          LOCATION
          ===================================================== */}

      <span
        className="
          flex
          items-center
          gap-[6px]
          text-[11px]
          font-normal
          leading-[14px]
          text-[#687384]
        "
      >
        <MapPin
          size={12}
          className="shrink-0"
          strokeWidth={1.8}
        />

        <span
          className="
            min-w-0
            overflow-hidden
            text-ellipsis
            whitespace-nowrap
          "
        >
          {application.jobLocation?.trim() ||
            candidate.location.trim() ||
            "Location not provided"}
        </span>
      </span>
    </button>
  );
}
