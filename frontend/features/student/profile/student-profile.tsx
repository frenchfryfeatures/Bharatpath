"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  BookOpen,
  CircleUser,
  Eye,
  GraduationCap,
  Lock,
  MapPin,
} from "lucide-react";

import {
  useGetStudentApplicationsQuery,
  useGetStudentCollegeLinksQuery,
  useGetStudentCoursesQuery,
  useGetStudentProfileQuery,
  useGetStudentScoreQuery,
  useUpdateStudentLocationMutation,
  useUpdateStudentNameMutation,
} from "@/store/student";
import {
  useGetNotificationPreferencesQuery,
  useUpdateNotificationPreferencesMutation,
} from "@/store/api/notification-api";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { showSuccessFeedback } from "@/lib/feedback/success-feedback";
import { initials } from "@/features/student/formatters";
import type { StudentProfile as StudentProfileData } from "@/features/student/types";
import {
  interactiveCardClass,
  NoteStrip,
  PillButton,
  SectionEyebrow,
  StudentCard,
} from "@/features/student/components";
import { StudentProfileSkeleton } from "@/features/student/loading";
import { StudentPage } from "@/features/student/shell";

export function StudentProfile() {
  const router = useRouter();
  const profile = useGetStudentProfileQuery();
  const score = useGetStudentScoreQuery();
  const applications = useGetStudentApplicationsQuery({ limit: 100 });
  const courses = useGetStudentCoursesQuery();
  const colleges = useGetStudentCollegeLinksQuery();
  const preferences = useGetNotificationPreferencesQuery();
  const [updatePreferences, preferencesState] =
    useUpdateNotificationPreferencesMutation();

  const notificationsEnabled = preferences.data?.push_enabled ?? false;
  const activeCollegeLinks =
    colleges.data?.filter((link) => link.revokedAt === null).length ?? 0;

  if (
    profile.isLoading ||
    score.isLoading ||
    applications.isLoading ||
    courses.isLoading ||
    colleges.isLoading ||
    preferences.isLoading
  ) {
    return <StudentProfileSkeleton />;
  }

  return (
    <StudentPage>
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-[#F1EAF7] text-[19px] font-bold text-[#4A3E8F]">
            {initials(profile.data?.fullName)}
          </span>
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-[18px] font-bold tracking-[-0.02em] text-[#0A1931] sm:text-[22px]">
              {profile.data?.fullName ?? "Student"}
            </span>
            <span className="text-[13px] text-[#5F6B80]">
              {[profile.data?.city, profile.data?.stateCode]
                .filter(Boolean)
                .join(", ") || "Location not added"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:max-w-md">
          <StatTile
            value={
              score.data?.status === "READY" && score.data.value != null
                ? String(score.data.value)
                : "—"
            }
            label="Score"
            tone="indigo"
            onClick={() => router.push("/student/score")}
          />
          <StatTile
            value={String(
              applications.data?.total ??
                applications.data?.items.length ??
                0,
            )}
            label="Applications"
            onClick={() => router.push("/student/board")}
          />
          <StatTile value={String(activeCollegeLinks)} label="Colleges" />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <SectionEyebrow icon={<CircleUser size={12} />}>
              My information
            </SectionEyebrow>
            {profile.data ? (
              <ProfileForm
                profile={profile.data}
              />
            ) : (
              <StudentCard>Loading profile…</StudentCard>
            )}

            <StudentCard>
              <div className="flex items-center gap-3">
                <BookOpen size={20} className="text-[#5F4DB2]" />
                <span className="flex flex-1 flex-col">
                  <span className="text-[15px] font-medium text-[#0A1931]">
                    Courses
                  </span>
                  <span className="text-[12px] text-[#5F6B80]">
                    {courses.data?.length ?? 0} available ·{" "}
                    {courses.data?.filter((course) => course.completed).length ?? 0} completed
                  </span>
                </span>
              </div>
            </StudentCard>
            <StudentCard>
              <div className="flex items-center gap-3">
                <GraduationCap size={20} className="text-[#5F4DB2]" />
                <span className="flex flex-1 flex-col">
                  <span className="text-[15px] font-medium text-[#0A1931]">
                    College links
                  </span>
                  <span className="text-[12px] text-[#5F6B80]">
                    {activeCollegeLinks} active
                  </span>
                </span>
              </div>
            </StudentCard>
          </div>

          <div className="flex flex-col gap-2">
            <SectionEyebrow icon={<Lock size={12} />}>Privacy and data</SectionEyebrow>
            <button
              type="button"
              onClick={() => router.push("/student/privacy")}
              className={`flex items-center gap-3 rounded-2xl border border-[#E7E0D4] bg-white p-4 text-left ${interactiveCardClass}`}
            >
              <Eye size={20} className="text-[#0A1931]" />
              <span className="flex flex-1 flex-col">
                <span className="text-[15px] font-medium text-[#0A1931]">
                  Profile visibility
                </span>
                <span className="text-[12px] text-[#5F6B80]">
                  Review what employers can access
                </span>
              </span>
            </button>
            <div className="flex items-center gap-3 rounded-2xl border border-[#E7E0D4] bg-white p-4">
              <Bell size={20} className="text-[#0A1931]" />
              <span className="flex flex-1 flex-col">
                <span className="text-[15px] font-medium text-[#0A1931]">
                  Push notifications
                </span>
                <span className="text-[12px] text-[#5F6B80]">
                  Application and account updates
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={notificationsEnabled}
                disabled={preferences.isLoading || preferencesState.isLoading}
                onClick={() =>
                  void updatePreferences({
                    push_enabled: !notificationsEnabled,
                  })
                }
                className={[
                  "flex h-7 w-12 cursor-pointer items-center rounded-full p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30",
                  notificationsEnabled
                    ? "justify-end bg-[#5F4DB2] enabled:hover:bg-[#4A3E8F]"
                    : "justify-start bg-[rgba(10,25,49,0.2)] enabled:hover:bg-[rgba(10,25,49,0.3)]",
                ].join(" ")}
              >
                <span className="h-5 w-5 rounded-full bg-white" />
              </button>
            </div>
            <NoteStrip icon={<MapPin size={16} />}>
              Only your city and state are used for job discovery. Do not enter a
              street address.
            </NoteStrip>
          </div>
        </div>
      </div>
    </StudentPage>
  );
}

function ProfileForm({
  profile,
}: {
  profile: StudentProfileData;
}) {
  const [updateName, nameState] = useUpdateStudentNameMutation();
  const [updateLocation, locationState] = useUpdateStudentLocationMutation();
  const [fullName, setFullName] = useState(profile.fullName ?? "");
  const [city, setCity] = useState(profile.city ?? "");
  const [stateCode, setStateCode] = useState(profile.stateCode ?? "");
  const profileError = nameState.error ?? locationState.error;

  const saveProfile = async () => {
    try {
      let saved = false;
      if (fullName.trim() !== (profile.fullName ?? "")) {
        await updateName(fullName.trim()).unwrap();
        saved = true;
      }
      if (
        city.trim() !== (profile.city ?? "") ||
        stateCode.trim().toUpperCase() !== (profile.stateCode ?? "")
      ) {
        await updateLocation({
          city: city.trim() || null,
          stateCode: stateCode.trim().toUpperCase() || null,
        }).unwrap();
        saved = true;
      }
      if (saved) {
        showSuccessFeedback("Profile updated.");
      }
    } catch {
      // The mutation error is rendered below the form.
    }
  };

  return (
    <StudentCard className="flex flex-col gap-3">
      <Field
        label="Full name"
        value={fullName}
        onChange={setFullName}
        placeholder="Your full name"
      />
      <div className="grid grid-cols-[1fr_7rem] gap-2">
        <Field
          label="City"
          value={city}
          onChange={setCity}
          placeholder="City"
        />
        <Field
          label="State"
          value={stateCode}
          onChange={setStateCode}
          placeholder="MH"
          maxLength={2}
        />
      </div>
      <PillButton
        disabled={
          nameState.isLoading || locationState.isLoading || !fullName.trim()
        }
        onClick={() => void saveProfile()}
      >
        {nameState.isLoading || locationState.isLoading
          ? "Saving…"
          : "Save profile"}
      </PillButton>
      {profileError ? (
        <NoteStrip tone="amber">
          {getApiErrorMessage(profileError, "Could not save your profile.")}
        </NoteStrip>
      ) : null}
    </StudentCard>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  maxLength?: number;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-[#3A4761]">
      {label}
      <input
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="rounded-xl border border-[#E7E0D4] bg-white px-3 py-2.5 text-[14px] font-normal text-[#0A1931] outline-none focus:border-[#5F4DB2]"
      />
    </label>
  );
}

function StatTile({
  value,
  label,
  tone = "cream",
  onClick,
}: {
  value: string;
  label: string;
  tone?: "cream" | "indigo";
  onClick?: () => void;
}) {
  const indigo = tone === "indigo";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={[
        "flex min-w-0 flex-1 flex-col gap-1 rounded-2xl border p-3 text-left",
        indigo
          ? "border-[#5F4DB2] bg-[#5F4DB2] text-white"
          : "border-[#E7E0D4] bg-white text-[#0A1931]",
        onClick
          ? indigo
            ? `${interactiveCardClass} hover:border-[#4A3E8F] hover:bg-[#5646A6]`
            : interactiveCardClass
          : "cursor-default",
      ].join(" ")}
    >
      <span className="text-[22px] font-extrabold leading-6">{value}</span>
      <span className={indigo ? "text-[12px] text-[#E0DBF4]" : "text-[12px] text-[#5F6B80]"}>
        {label}
      </span>
    </button>
  );
}
