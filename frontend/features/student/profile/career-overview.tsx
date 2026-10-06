"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useGetResumeVersionsQuery } from "@/store/student";
import {
  BriefcaseBusiness,
  FileText,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Wallet,
  CalendarDays,
} from "lucide-react";
import {
  useGetCareerIdentityQuery,
  useGetCareerFieldsQuery,
  useGetCareerProfileQuery,
  useLazyGetProfileResumeDocumentQuery,
  usePrefillCareerProfileMutation,
  visibleCareerField,
} from "./career-api";
import { CareerForm, type CareerEditSection } from "./career-form";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { Modal } from "@/components/ui/modal";
import { PillButton } from "@/features/student/components";

const groups = [
  { id: "headline", title: "Profile headline" },
  { id: "employment", title: "Employment" },
  { id: "education", title: "Education" },
  { id: "preferences", title: "Career preferences" },
  { id: "basic", title: "Basic details" },
];
const editableSections = ["basic", "employment", "education", "preferences"] as const;
const quickLinks = [
  ...groups,
  { id: "reports", title: "Reports and learning" },
  { id: "privacy", title: "Privacy and account" },
];
const money = (value: unknown) =>
  typeof value === "number"
    ? new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(value)
    : "Not added";

export function CareerOverview({
  fullName,
  email,
  summaryStats,
  children,
}: {
  fullName: string;
  email: string;
  summaryStats?: ReactNode;
  children?: ReactNode;
}) {
  const profile = useGetCareerProfileQuery();
  const account = useGetCareerIdentityQuery();
  const versions = useGetResumeVersionsQuery();
  const [prefill, prefillState] = usePrefillCareerProfileMutation();
  const attemptedPrefill = useRef<string | null>(null);
  const fields = useGetCareerFieldsQuery();
  const [editingSection, setEditingSection] = useState<CareerEditSection | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const latest = versions.data?.find((version) => !version.superseded);
    if (
      !profile.data ||
      profile.data.resume_version_id ||
      !latest ||
      attemptedPrefill.current === latest.resumeVersionId
    )
      return;
    attemptedPrefill.current = latest.resumeVersionId;
    void prefill(latest.resumeVersionId)
      .unwrap()
      .catch((failure) =>
        setError(
          getApiErrorMessage(
            failure,
            "Existing resume details could not be imported. You can add them with Edit profile details.",
          ),
        ),
      );
  }, [profile.data, versions.data, prefill]);
  const details = profile.data?.details ?? {};
  const added =
    fields.data?.filter((field) => {
      const value = details[field.key];
      return Array.isArray(value)
        ? value.length
        : value !== null && value !== undefined && value !== "";
    }).length ?? 0;
  const completion = fields.data?.length
    ? Math.round((added / fields.data.length) * 100)
    : 0;

  return (
    <div className="flex flex-col gap-5 font-sans text-[13px] leading-5 text-[#0A1931]">
      <section className="grid gap-4 rounded-[20px] border border-[#E7E0D4] bg-white p-4 lg:grid-cols-[64px_minmax(0,1fr)_240px]">
        <div className="flex flex-col items-center gap-2">
          <span className="grid h-16 w-16 place-items-center rounded-full border-2 border-[#5F4DB2] bg-[#F1EAF7] text-[22px] font-bold leading-7 text-[#5F4DB2]">
            {fullName
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0])
              .join("")}
          </span>
          <span className="text-center text-[10px] font-semibold leading-4 text-[#5F6B80]">
            {profile.data ? `${completion}% details added` : "Profile details"}
          </span>
        </div>
        <div>
          <h1 className="text-[18px] font-bold leading-7 tracking-[-0.02em] text-[#0A1931] sm:text-[22px]">
            {fullName || "Your profile"}
          </h1>
          <p className="mt-1 text-[14px] font-medium leading-5 text-[#3A4761]">
            {String(
              details.job_title ||
                details.headline ||
                "Add your profile headline",
            )}
          </p>
          {details.company_name && (
            <p className="text-[13px] leading-5 text-[#5F6B80]">
              at {String(details.company_name)}
            </p>
          )}
          <div className="mt-3 grid gap-2.5 border-t border-[#F0EBDF] pt-3 text-[13px] leading-5 text-[#3A4761] sm:grid-cols-2">
            <p className="flex gap-2">
              <MapPin size={17} />
              {String(details.current_city || "Location not added")}
            </p>
            <p className="flex gap-2">
              <Phone size={17} />
              {String(details.phone || "Mobile not added")}
            </p>
            <p className="flex gap-2">
              <BriefcaseBusiness size={17} />
              {details.work_status === "FRESHER"
                ? "Fresher"
                : details.work_status === "EXPERIENCED"
                  ? `${details.experience_years ?? 0} years ${details.experience_months ?? 0} months`
                  : "Experience not added"}
            </p>
            <p className="flex min-w-0 items-center gap-2">
              <Mail size={17} className="shrink-0" />
              <span className="truncate">{email || account.data?.email}</span>
            </p>
            <p className="flex gap-2">
              <Wallet size={17} />
              {money(details.annual_salary)}
            </p>
            <p className="flex gap-2">
              <CalendarDays size={17} />
              {String(details.notice_period || "Notice period not added")
                .replaceAll("_", " ")
                .toLowerCase()}
            </p>
          </div>
          {profile.data?.updated_at && (
            <p className="mt-3 text-[11px] font-medium leading-4 text-[#7B8495]">
              Updated{" "}
              {new Date(profile.data.updated_at).toLocaleDateString("en-IN")}
            </p>
          )}
          {summaryStats && (
            <div className="mt-4 border-t border-[#F0EBDF] pt-4">
              {summaryStats}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-4 self-start rounded-[16px] bg-[#F1EAF7] p-4">
          <p className="text-[15px] font-semibold leading-5 text-[#0A1931]">
            Keep your profile up to date
          </p>
          <p className="text-[13px] leading-5 text-[#5F6B80]">
            Review the details extracted from your resume and add anything
            missing.
          </p>
          <PillButton onClick={() => setEditingSection("all")} className="w-full">
            Edit profile details
          </PillButton>
        </div>
      </section>
      {profile.isError && (
        <p
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-[#E7E0D4] bg-[#F7F4EC] px-4 py-3 text-[13px] leading-5 text-[#5F6B80]"
        >
          Your saved career details are temporarily unavailable.
          <button
            type="button"
            onClick={() => {
              void profile.refetch();
              void fields.refetch();
            }}
            className="font-semibold text-[#5F4DB2] hover:text-[#4A3E8F]"
          >
            Try again
          </button>
        </p>
      )}
      {prefillState.isLoading && (
        <p className="rounded-xl bg-[#F1EAF7] p-4 text-[13px] leading-5 text-[#5F4DB2]">
          Importing your existing resume into your profile. Your score is
          unchanged.
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav
          aria-label="Profile quick links"
          className="hidden h-fit rounded-[20px] border border-[#E7E0D4] bg-white p-4 lg:sticky lg:top-24 lg:block"
        >
          <h2 className="mb-3 text-[15px] font-semibold leading-5">
            Quick links
          </h2>
          {quickLinks.map((group) => (
            <a
              key={group.id}
              href={`#profile-${group.id}`}
              className="block rounded-lg px-2 py-2.5 text-[13px] font-medium leading-5 text-[#3A4761] transition hover:bg-[#F7F4EC] hover:text-[#0A1931]"
            >
              {group.title}
            </a>
          ))}
        </nav>
        <div className="flex min-w-0 flex-col gap-4">
          {groups.map((group) => (
            <section
              key={group.id}
              id={`profile-${group.id}`}
              className="scroll-mt-24 rounded-[20px] border border-[#E7E0D4] bg-white p-4"
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold leading-5 text-[#0A1931]">
                  {group.title}
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setEditingSection(group.id as CareerEditSection);
                  }}
                  aria-label={`Edit ${group.title}`}
                  className="grid h-9 w-9 place-items-center rounded-xl border border-[#E7E0D4] text-[#5F4DB2] transition hover:bg-[#F1EAF7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30"
                >
                  <Pencil size={17} />
                </button>
              </div>
              {group.id === "headline" ? (
                <p className="text-[13px] leading-5 text-[#3A4761]">
                  {String(
                    details.headline ||
                      (profile.isError
                        ? "Headline unavailable"
                        : "Add a headline that describes your skills and career goals."),
                  )}
                </p>
              ) : (
                <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  {fields.data
                    ?.filter(
                      (field) =>
                        field.section === group.id &&
                        field.key !== "headline" &&
                        visibleCareerField(field, details),
                    )
                    .map((field) => {
                      const value = details[field.key];
                      const text =
                        field.options.find((option) => option.value === value)
                          ?.label ??
                        (Array.isArray(value)
                          ? value.length
                            ? value.join(", ")
                            : "Not added"
                          : value === null ||
                              value === undefined ||
                              value === ""
                            ? "Not added"
                            : String(value));
                      return (
                        <div key={field.key}>
                          <dt className="text-[11px] font-medium leading-4 text-[#7B8495]">
                            {field.label}
                          </dt>
                          <dd className="mt-1 text-[14px] font-medium leading-5 text-[#0A1931]">
                            {field.key.includes("salary") ? money(value) : text}
                          </dd>
                        </div>
                      );
                    })}
                </dl>
              )}
            </section>
          ))}
          {children}
        </div>
      </div>
      {editingSection !== null && (
        <Modal
          open
          variant="student"
          onClose={() => setEditingSection(null)}
          title={editingSection === "all" ? "Edit profile details" : `Edit ${groups.find((group) => group.id === editingSection)?.title.toLowerCase()}`}
          panelClassName="max-w-3xl"
        >
          <div className="max-h-[75vh] overflow-y-auto p-1">
            <CareerForm
              key={editingSection}
              editing
              editSection={editingSection}
              initialSection={editingSection === "headline" ? 3 : Math.max(0, editableSections.indexOf(editingSection as (typeof editableSections)[number]))}
              onDone={() => setEditingSection(null)}
              onBack={() => setEditingSection(null)}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
