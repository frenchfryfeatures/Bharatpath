"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  Check,
  Copy,
  FileSpreadsheet,
  Gauge,
  type LucideIcon,
  Ticket,
  Users,
  UserCheck,
} from "lucide-react";

import { usePageHeader } from "@/components/layout/header-context";
import { CardSkeletonGrid, Skeleton } from "@/components/common/loading";
import { MetricCard } from "../../../../components/common/dashboard/metric-card";
import { showSuccessFeedback } from "@/lib/feedback/success-feedback";
import { useDashboard } from "../hooks/use-dashboard";
import { ScoreDistribution } from "./score-distribution";

function formatMetric(value: number | null): string | number {
  return value ?? "—";
}

export function CollegeDashboard() {
  const router = useRouter();
  const {
    data,
    isLoadingOverview,
    isLoadingSeats,
    isLoadingReferralCodes,
  } = useDashboard();

  usePageHeader(
    "Dashboard",
    "Cohort overview, linking code and recent activity",
    {
      stat: {
        icon: Users,
        label: `${data.seatsUsed} / ${data.seatsTotal} seats used`,
        sublabel: `${Math.max(data.seatsAvailable, 0)} seats remaining`,
        progress:
          data.seatsTotal > 0
            ? (data.seatsUsed / data.seatsTotal) * 100
            : 0,
        isLoading: isLoadingSeats,
      },
    },
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Metrics */}
      {isLoadingOverview ? (
        <CardSkeletonGrid count={4} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Students linked"
            value={data.connectedStudents}
            icon={Users}
            tone="purple"
            onClick={() => router.push("/college/students")}
          />

          <MetricCard
            title="Individually visible"
            value={data.individuallyVisible}
            icon={UserCheck}
            tone="green"
            onClick={() => router.push("/college/students")}
          />

          <MetricCard
            title="Median score"
            value={formatMetric(data.medianScore)}
            icon={Gauge}
            tone="blue"
            onClick={() => router.push("/college/analytics")}
          />

          <MetricCard
            title="Hired via platform"
            value={formatMetric(data.platformHires)}
            icon={Briefcase}
            tone="orange"
            onClick={() => router.push("/college/analytics#hires")}
          />
        </div>
      )}

      {/* Main dashboard */}
      <div className="grid items-start gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* Left column */}
        <div className="flex min-w-0 flex-col gap-4">
          {isLoadingOverview ? (
            <Skeleton height={280} radius={12} />
          ) : (
            <Link
              href="/college/analytics"
              aria-label="Open cohort analytics"
              className="block rounded-xl transition-all duration-150 hover:-translate-y-px hover:shadow-[0_6px_18px_rgba(19,26,38,0.05)] focus:outline-none focus:ring-2 focus:ring-[#5b4fcf]/20"
            >
              <ScoreDistribution
                bands={data.bands}
                medianScore={data.medianScore}
                belowFloor={data.belowFloor}
                minCohortSize={data.minCohortSize}
              />
            </Link>
          )}

          {isLoadingReferralCodes ? (
            <Skeleton height={132} radius={12} />
          ) : (
            <ReferralCode code={data.referralCode} />
          )}
        </div>

        {/* Right column */}
        {isLoadingOverview ? (
          <Skeleton height={280} radius={12} />
        ) : (
          <CohortFunnel
            applicants={data.applicants}
            applications={data.applications}
            interviews={data.interviews}
            hires={data.platformHires}
          />
        )}
      </div>
    </div>
  );
}

function CohortFunnel({
  applicants,
  applications,
  interviews,
  hires,
}: Readonly<{
  applicants: number | null;
  applications: number | null;
  interviews: number | null;
  hires: number | null;
}>) {
  const rows: { label: string; value: number | null }[] = [
    { label: "Applicants", value: applicants },
    { label: "Applications", value: applications },
    { label: "Interviews", value: interviews },
    { label: "Hired via platform", value: hires },
  ];

  return (
    <Link
      href="/college/analytics"
      aria-label="Open cohort activity analytics"
      className="flex flex-col gap-3 rounded-xl border border-[#e5e7ec] bg-white p-5 transition-all duration-150 hover:-translate-y-px hover:border-[#d9dce4] hover:shadow-[0_6px_18px_rgba(19,26,38,0.05)] focus:outline-none focus:ring-2 focus:ring-[#5b4fcf]/20"
    >
      <div className="flex flex-col gap-[2px]">
        <h2 className="text-sm font-semibold text-[#151b2b]">
          Cohort activity
        </h2>
        <p className="text-xs text-[#8a91a0]">
          Placement funnel for students who consented to share.
        </p>
      </div>

      <div className="flex flex-col divide-y divide-[#eef0f3]">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between py-2.5"
          >
            <span className="text-[13px] text-[#303747]">
              {row.label}
            </span>
            <span className="text-[15px] font-semibold text-[#151b2b]">
              {row.value ?? "—"}
            </span>
          </div>
        ))}
      </div>
    </Link>
  );
}

function ReferralCode({
  code,
}: Readonly<{
  code: string | null;
}>) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!code) {
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      showSuccessFeedback("Referral code copied successfully.");

      setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="
        flex flex-col gap-3
        rounded-xl
        border border-[#e5e7ec]
        bg-white
        p-5
        shadow-[0_4px_12px_rgba(19,26,38,0.024)]
        transition-all
        duration-150
        hover:-translate-y-px
        hover:border-[#d9dce4]
        hover:shadow-[0_6px_18px_rgba(19,26,38,0.05)]
      "
    >
      {/* Header */}
      <div className="flex flex-col gap-[2px]">
        <h2
          className="
            text-[14px]
            font-[600]
            leading-[18px]
            text-[#151b2b]
          "
          style={{
            fontFamily: "'General Sans', sans-serif",
            fontWeight: 600,
          }}
        >
          Referral code
        </h2>

        <p
          className="
            text-[12px]
            font-[400]
            leading-[17px]
            text-[#303747]
          "
          style={{
            fontFamily: "'General Sans', sans-serif",
            fontWeight: 400,
          }}
        >
          Students enter this code in the BharatPath app
          to link their account to your institution.
        </p>
      </div>

      {/* Referral code */}
      <div
        className="
          flex
          items-center
          gap-[10px]
          rounded-xl
          border
          border-dashed
          border-[#e5e7ec]
          bg-[#f5f6f8]
          px-4
          py-3
        "
      >
        <code
          className="
            min-w-0
            flex-1
            truncate
            text-[18px]
            font-[700]
            leading-[23px]
            tracking-[0.04em]
            text-[#151b2b]
          "
          style={{
            fontFamily: "'General Sans', sans-serif",
            fontWeight: 700,
          }}
        >
          {code ?? "No active code"}
        </code>

        <button
          type="button"
          onClick={handleCopy}
          disabled={!code}
          className="
            flex
            shrink-0
            items-center
            gap-[6px]
            rounded-lg
            border
            border-[#e5e7ec]
            bg-white
            px-3
            py-2
            text-[12px]
            font-[600]
            leading-[16px]
            text-[#151b2b]
            transition-colors
            hover:bg-[#f8f9fb]
            disabled:cursor-not-allowed
            disabled:opacity-50
          "
          style={{
            fontFamily: "'General Sans', sans-serif",
            fontWeight: 600,
          }}
        >
          {copied ? (
            <Check size={14} strokeWidth={2} />
          ) : (
            <Copy size={14} strokeWidth={2} />
          )}

          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/* Quick actions */}
      <div className="flex gap-[10px] border-t border-[#eef0f3] pt-3">
        <QuickAction
          icon={Ticket}
          label="Issue a referral code"
          href="/college/students#referral-codes"
        />

        <QuickAction
          icon={FileSpreadsheet}
          label="Bulk upload a roster"
          href="/college/students#bulk-upload"
        />
      </div>
    </div>
  );
}

function QuickAction({
  icon: Icon,
  label,
  href,
}: Readonly<{
  icon: LucideIcon;
  label: string;
  href: string;
}>) {
  return (
    <Link
      href={href}
      className="
        flex
        min-w-0
        flex-1
        items-center
        gap-[10px]
        rounded-[10px]
        border
        border-[#e5e7ec]
        bg-white
        p-3
        text-left
        transition-all
        duration-150
        hover:-translate-y-px
        hover:border-[#d9dce4]
        hover:bg-[#f8f9fb]
        hover:shadow-sm
        focus:outline-none
        focus:ring-2
        focus:ring-[#5b4fcf]/20
      "
    >
      <span
        className="
          grid
          h-8
          w-8
          shrink-0
          place-items-center
          rounded-lg
          bg-[#eef0ff]
        "
      >
        <Icon
          size={16}
          strokeWidth={2}
          className="text-[#4e43b7]"
        />
      </span>

      <span
        className="
          min-w-0
          flex-1
          text-[13px]
          font-[600]
          leading-[17px]
          text-[#151b2b]
        "
        style={{
          fontFamily: "'General Sans', sans-serif",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
    </Link>
  );
}