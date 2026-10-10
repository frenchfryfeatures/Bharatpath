"use client";

import { Building2, EyeOff, Info, ShieldCheck } from "lucide-react";

import { Skeleton } from "@/components/common/loading";
import { EmptyState, NoteStrip, StudentErrorState } from "@/features/student/components";
import { formatDateTime } from "@/features/student/formatters";
import { StudentPage, StudentTopBar } from "@/features/student/shell";
import { useGetStudentProfileViewsQuery } from "@/store/student";
import { DataRights } from "./data-rights";

export function WhoSawMe() {
  const views = useGetStudentProfileViewsQuery({ limit: 100 });

  return (
    <StudentPage>
      <div className="flex flex-col gap-5 sm:gap-7">
        <StudentTopBar title="Profile visibility" className="!mb-0" />
        <header className="rounded-[24px] border border-[#E7E0D4] bg-white px-5 py-5 sm:px-7 sm:py-6">
          <h1 className="text-2xl font-extrabold tracking-[-0.03em] text-[#0A1931] sm:text-3xl">Who has seen me</h1>
          <p className="mt-1 text-[14px] leading-6 text-[#5F6B80]">See which employers have opened your profile.</p>
        </header>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(280px,1fr)] lg:gap-5">
          <section className="rounded-[24px] border border-[#E7E0D4] bg-white p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-[#F0EBDF] pb-4">
              <div>
                <h2 className="text-[15px] font-bold text-[#0A1931]">Recent profile views</h2>
                <p className="mt-0.5 text-[12px] text-[#5F6B80]">Employers who opened your profile</p>
              </div>
              <span className="shrink-0 rounded-full bg-[#F5F1FA] px-3 py-1 text-[11px] font-semibold text-[#5F4DB2]">Last 90 days</span>
            </div>
            {views.isLoading ? (
              <div className="flex flex-col gap-4" aria-label="Loading profile views">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="flex items-center gap-3">
                    <Skeleton circle width={42} height={42} />
                    <div className="flex flex-1 flex-col gap-2"><Skeleton width="45%" height={14} radius={6} /><Skeleton width="30%" height={11} radius={6} /></div>
                  </div>
                ))}
              </div>
            ) : views.isError ? (
              <StudentErrorState variant="inline" error={views.error} fallback="We could not load who viewed your profile." onRetry={() => void views.refetch()} />
            ) : views.data?.items.length ? (
              <ul className="flex flex-col divide-y divide-[#F0EBDF]">
                {views.data.items.map((view) => (
                  <li key={`${view.employerName}-${view.lastViewedAt}`} className="flex items-center gap-3 py-4 first:pt-0 last:pb-0">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#F1EAF7] text-[#5F4DB2]"><Building2 size={20} aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold text-[#0A1931]">{view.employerName}</span><span className="mt-0.5 block text-[12px] text-[#5F6B80]">Opened {formatDateTime(view.lastViewedAt)}</span></span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<EyeOff size={22} />} title="No employer views yet" message="When an employer views your profile, their activity will be logged here." />
            )}
          </section>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
            <NoteStrip icon={<Info size={16} />}>Verified employers can see your CV and contact details when they open your profile. This list shows which organisations did.</NoteStrip>
            <div className="rounded-[20px] border border-[#E7E0D4] bg-white p-5">
              <div className="mb-2 flex items-center gap-2"><ShieldCheck size={17} className="text-[#1F6B45]" aria-hidden="true" /><p className="text-[14px] font-semibold text-[#0A1931]">Your privacy is protected</p></div>
              <p className="mt-2 text-[12px] leading-5 text-[#5F6B80]">We show the employer organisation, never the individual recruiter or how many times they opened your profile.</p>
            </div>
          </aside>
        </div>
        <DataRights />
      </div>
    </StudentPage>
  );
}
