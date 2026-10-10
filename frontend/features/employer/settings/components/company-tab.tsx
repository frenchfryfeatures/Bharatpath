"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileCheck2,
  FileText,
  Globe,
  ExternalLink,
  Lock,
  Loader2,
  ShieldCheck,
} from "lucide-react";

import { AppSelect } from "@/components/ui/app-select";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { ChangePasswordModal } from "@/components/auth/change-password-modal";
import { MfaSettingsControl } from "@/components/auth/mfa-settings-control";
import { Skeleton } from "@/components/common/loading";
import { EmployerErrorState } from "@/features/employer/components/employer-error-state";
import { INDIAN_STATES } from "@/features/student/onboarding/constants";
import { KybReviewHistory } from "@/features/employer/onboarding/components/kyb-review-history";
import { useGetEmployerKybFormQuery, useGetEmployerKybQuery } from "@/store/employer/kyb";
import {
  clearPendingTab,
  replaceCompanyProfile,
  saveCompanyProfile,
  selectCompanyProfile,
  selectPendingTab,
  setActiveTab,
  setHasUnsavedChanges,
  updateCompanyField,
  useGetEmployerOrganisationQuery,
  useGetEmployerReferenceQuery,
  useUpdateEmployerOrganisationMutation,
  type CompanyProfile,
  type EditableCompanyField,
} from "@/store/employer/settings";
import {
  KybChangesPanel,
  needsVerificationChanges,
  useKybDocumentViewer,
} from "./kyb-changes-panel";
import { useSessionIdentity } from "@/lib/auth/use-session-identity";
import { useAppDispatch, useAppSelector } from "@/store/hooks";

const inputClass =
  "min-h-[42px] w-full rounded-[9px] border border-[#dfe4ea] bg-white px-3.5 text-[13px] text-[#111827] outline-none transition placeholder:text-[#9aa2b1] focus:border-[#3566b8] focus:ring-4 focus:ring-[#3566b8]/10 disabled:cursor-not-allowed disabled:bg-[#f8fafc] disabled:text-[#475569] disabled:border-[#e2e8f0]";

const lockedInputClass =
  "min-h-[42px] w-full rounded-[9px] border border-[#e2e8f0] bg-[#f8fafc] px-3.5 text-[13px] font-medium text-[#334155] cursor-not-allowed selection:bg-transparent";

const selectClass =
  "[&>button]:min-h-[42px] [&>button]:rounded-[9px] [&>button]:border-[#dfe4ea] [&>button>span]:text-[13px] [&>button>span]:font-normal [&>button>span]:text-[#111827]";

const EMPLOYEE_COUNT_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "1_10", label: "1-10 employees" },
  { value: "11_50", label: "11-50 employees" },
  { value: "51_200", label: "51-200 employees" },
  { value: "201_500", label: "201-500 employees" },
  { value: "501_1000", label: "501-1,000 employees" },
  { value: "1001_5000", label: "1,001-5,000 employees" },
  { value: "5000_PLUS", label: "More than 5,000 employees" },
];

const EMPLOYER_TYPE_MAP: Record<string, string> = {
  STARTUP: "Startup",
  PRIVATE_LIMITED: "Private company",
  PUBLIC_LIMITED: "Public limited company",
  MNC: "Multinational corporation",
  GOVERNMENT: "Government or public sector",
  NGO: "NGO or non-profit",
  STAFFING_AGENCY: "Staffing or recruitment agency",
  EDUCATIONAL_INSTITUTION: "College or university",
  PROPRIETORSHIP: "Proprietorship or partnership",
};

const URL_REGEX = /^https:\/\/([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/\S*)?$/;

/** The fields this tab saves. Statutory details are KYB's and never sent. */
const EDITABLE_FIELDS: readonly EditableCompanyField[] = [
  "tradeName",
  "industry",
  "employeeCountBand",
  "website",
  "about",
];

/** "acme.in" becomes "https://acme.in"; the server accepts https only. */
function normaliseWebsite(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getStateName(codeOrName?: string) {
  if (!codeOrName) return "";
  const match = INDIAN_STATES.find(
    (s) =>
      s.code.toLowerCase() === codeOrName.toLowerCase() ||
      s.name.toLowerCase() === codeOrName.toLowerCase(),
  );
  return match ? match.name : codeOrName;
}

function getEmployerTypeLabel(
  typeCode?: string,
  referenceTypes?: Array<{ code: string; label: string }>,
) {
  if (!typeCode) return "—";
  const fromRef = referenceTypes?.find((t) => t.code === typeCode);
  if (fromRef) return fromRef.label;
  return EMPLOYER_TYPE_MAP[typeCode] || typeCode;
}

function StatusBadge({ status }: { status: string }) {
  const norm = status.toUpperCase();

  if (norm === "APPROVED") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ecfdf3] px-3 py-1 text-xs font-semibold text-[#027a48] ring-1 ring-inset ring-[#abefc6]">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        Verified Business
      </span>
    );
  }

  if (norm === "UNDER_REVIEW" || norm === "SUBMITTED") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fef6ee] px-3 py-1 text-xs font-semibold text-[#b54708] ring-1 ring-inset ring-[#f9dbaf]">
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        Verification in review
      </span>
    );
  }

  if (norm === "MORE_INFO_REQUIRED" || norm === "REJECTED") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fef3f2] px-3 py-1 text-xs font-semibold text-[#b42318] ring-1 ring-inset ring-[#fecdca]">
        <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
        Action required
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f8f9fc] px-3 py-1 text-xs font-semibold text-[#475467] ring-1 ring-inset ring-[#eaecf0]">
      <FileText className="h-3.5 w-3.5" aria-hidden="true" />
      {norm ? norm.replace(/_/g, " ") : "Draft"}
    </span>
  );
}

/** "On file" chip with a button that opens the uploaded file in a new tab. */
function OnFileChip({ onView }: { onView: () => Promise<boolean> }) {
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex items-center gap-1 rounded bg-[#ecfdf3] px-2 py-0.5 text-[11px] font-medium text-[#027a48]">
        <CheckCircle2 className="h-3 w-3" /> On file
      </span>
      <button
        type="button"
        disabled={opening}
        onClick={async () => {
          setOpening(true);
          setFailed(false);
          setFailed(!(await onView()));
          setOpening(false);
        }}
        className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-semibold text-[#3566b8] hover:underline disabled:cursor-wait disabled:opacity-60"
        title={failed ? "Could not open the file. Try again." : "Open the uploaded file"}
      >
        {opening ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        ) : (
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        )}
        {failed ? "Retry" : "View"}
      </button>
    </span>
  );
}

function CompanyTabSkeleton() {
  return (
    <div className="w-full space-y-6">
      <section className="rounded-xl border border-[#e0e4e9] bg-white p-6 shadow-sm">
        <div className="space-y-3">
          <Skeleton width={160} height={20} radius={6} />
          <Skeleton width={320} height={14} radius={6} />
          <div className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-2">
            <Skeleton height={42} radius={8} />
            <Skeleton height={42} radius={8} />
            <Skeleton height={42} radius={8} />
            <Skeleton height={42} radius={8} />
          </div>
        </div>
      </section>
      <section className="rounded-xl border border-[#e0e4e9] bg-white p-6 shadow-sm">
        <div className="space-y-3">
          <Skeleton width={200} height={20} radius={6} />
          <div className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-2">
            <Skeleton height={42} radius={8} />
            <Skeleton height={42} radius={8} />
          </div>
        </div>
      </section>
    </div>
  );
}

export function CompanyTab() {
  const isOwner = useSessionIdentity().user?.backendRole === "EMPLOYER_OWNER";
  const dispatch = useAppDispatch();
  const company = useAppSelector(selectCompanyProfile);
  const pendingTab = useAppSelector(selectPendingTab);

  const {
    data: organisation,
    isError: isOrgError,
    isLoading: isOrgLoading,
  } = useGetEmployerOrganisationQuery();

  const {
    data: kyb,
    isError: isKybError,
    isLoading: isKybLoading,
  } = useGetEmployerKybQuery(undefined, { skip: !isOwner });

  const { data: kybForm } = useGetEmployerKybFormQuery(undefined, { skip: !isOwner });
  const viewDocument = useKybDocumentViewer();
  const { data: reference } = useGetEmployerReferenceQuery();
  const [updateOrganisation, { isLoading: isSaving }] =
    useUpdateEmployerOrganisationMutation();
  const [passwordOpen, setPasswordOpen] = useState(false);

  const [showUndertakings, setShowUndertakings] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<unknown>(null);

  // Holds the baseline values when page is loaded or last saved, to calculate isDirty
  const baselineRef = useRef<CompanyProfile | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Link navigation intercept state
  const [pendingNavigationUrl, setPendingNavigationUrl] = useState<string | null>(null);

  // An earlier preview of this page kept the profile, PAN and GSTIN included,
  // in localStorage under keys shared by every account on the browser. The
  // server is the record now; remove what that preview left behind.
  useEffect(() => {
    try {
      localStorage.removeItem("bharatpath_employer_custom_profile");
      localStorage.removeItem("bharatpath_employer_locked_fields");
    } catch {
      // Storage unavailable: nothing was kept there either.
    }
  }, []);

  // Initialize and load baseline data
  useEffect(() => {
    if (!organisation && !kyb) return;

    const kybAnswers = (kyb?.answers ?? {}) as Record<string, unknown>;
    const kybDocs = (kyb?.documents ?? []).map((doc) => ({
      docType: doc.docType,
      mime: doc.mime,
      uploadedAt: doc.uploadedAt,
    }));

    const stateName = getStateName(text(kybAnswers.state));
    const formattedAddress = [
      text(kybAnswers.address_line1),
      text(kybAnswers.address_line2),
      text(kybAnswers.city),
      stateName,
      text(kybAnswers.pincode),
    ]
      .filter(Boolean)
      .join(", ");

    // An organisation that has never saved its profile starts from what it
    // told KYB. Once any of the four is saved, the organisation's own values
    // are the record, so a field cleared on purpose stays cleared.
    const neverSaved =
      !organisation?.tradeName &&
      !organisation?.employeeCountBand &&
      !organisation?.website &&
      !organisation?.about;
    const profile = (saved: string | undefined, answer: unknown) =>
      saved || (neverSaved ? text(answer) : "");

    const initialCompany: CompanyProfile = {
      legalName: organisation?.legalName || text(kybAnswers.legal_name),
      businessType: organisation?.businessType || text(kybAnswers.employer_type),
      industry: organisation?.industry || text(kybAnswers.industry),
      kybStatus: organisation?.kybStatus || kyb?.state || "DRAFT",
      pan: text(kybAnswers.pan),
      gstin: text(kybAnswers.gstin),
      cin: text(kybAnswers.cin),
      tan: text(kybAnswers.tan),
      address: formattedAddress,
      addressLine1: text(kybAnswers.address_line1),
      addressLine2: text(kybAnswers.address_line2),
      city: text(kybAnswers.city),
      state: stateName,
      pincode: text(kybAnswers.pincode),
      signatoryName: text(kybAnswers.signatory_name),
      signatoryDesignation: text(kybAnswers.signatory_designation),
      workEmail: text(kybAnswers.work_email),
      workPhone: text(kybAnswers.work_phone),
      documents: kybDocs,
      // What the owner actually ticked. Never defaulted to true: an
      // undertaking nobody gave must not be drawn as given.
      undertakings: {
        genuineHiring: kybAnswers.undertaking_genuine_hiring === true,
        noRedistribution: kybAnswers.undertaking_no_redistribution === true,
        authorised: kybAnswers.undertaking_authorised === true,
        submittedAt: kyb?.submittedAt ?? null,
      },
      tradeName: profile(organisation?.tradeName, kybAnswers.trade_name),
      employeeCountBand: profile(
        organisation?.employeeCountBand,
        kybAnswers.employee_count_band,
      ),
      website: profile(organisation?.website, kybAnswers.website),
      about: profile(organisation?.about, kybAnswers.about),
    };

    // The dirty-state effect below recomputes from the new profile.
    baselineRef.current = initialCompany;
    dispatch(replaceCompanyProfile(initialCompany));
  }, [dispatch, organisation, kyb]);

  // Compute dirty state whenever company values change
  useEffect(() => {
    if (!baselineRef.current) return;
    const b = baselineRef.current;

    const changed = EDITABLE_FIELDS.some((field) => company[field] !== b[field]);

    setIsDirty(changed);
    dispatch(setHasUnsavedChanges(changed));
  }, [company, dispatch]);

  // Intercept anchor link clicks when there are unsaved changes
  useEffect(() => {
    if (!isDirty) return;

    const handleAnchorClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest("a");
      if (target?.href && !target.href.startsWith("javascript:") && !target.target) {
        e.preventDefault();
        setPendingNavigationUrl(target.href);
      }
    };

    document.addEventListener("click", handleAnchorClick, true);
    return () => document.removeEventListener("click", handleAnchorClick, true);
  }, [isDirty]);

  if (isOrgLoading && isKybLoading) {
    return <CompanyTabSkeleton />;
  }

  const update =
    (field: EditableCompanyField) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const val = event.target.value;
      dispatch(updateCompanyField({ field, value: val }));

      // Clear field error on change
      if (validationErrors[field]) {
        setValidationErrors((prev) => {
          const next = { ...prev };
          delete next[field];
          return next;
        });
      }
    };

  const updateValue = (field: EditableCompanyField) => (value: string) => {
    dispatch(updateCompanyField({ field, value }));
  };

  const validateAll = (): boolean => {
    const errors: Record<string, string> = {};
    const website = normaliseWebsite(company.website);
    if (website && !URL_REGEX.test(website)) {
      errors.website = "Enter a website starting with https:// (e.g. https://yourcompany.in).";
    }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateAll() || !baselineRef.current) return;
    const baseline = baselineRef.current;
    const next: CompanyProfile = { ...company, website: normaliseWebsite(company.website) };

    // Send only what changed, so a save never clears a field nobody touched.
    const changes: Partial<Pick<CompanyProfile, EditableCompanyField>> = {};
    for (const field of EDITABLE_FIELDS) {
      if (next[field] !== baseline[field]) changes[field] = next[field];
    }

    setSaveError(null);
    try {
      await updateOrganisation(changes).unwrap();
    } catch (error) {
      setSaveError(error);
      return;
    }

    baselineRef.current = next;
    dispatch(replaceCompanyProfile(next));
    setIsDirty(false);
    dispatch(setHasUnsavedChanges(false));
    dispatch(saveCompanyProfile());
  };

  // User confirms leaving without saving (via modal)
  const handleDiscardAndLeave = () => {
    setIsDirty(false);
    dispatch(setHasUnsavedChanges(false));

    if (baselineRef.current) {
      dispatch(replaceCompanyProfile(baselineRef.current));
    }

    if (pendingTab) {
      const destination = pendingTab;
      dispatch(clearPendingTab());
      dispatch(setActiveTab(destination));
    } else if (pendingNavigationUrl) {
      const url = pendingNavigationUrl;
      setPendingNavigationUrl(null);
      window.location.href = url;
    }
  };

  const handleStayOnPage = () => {
    dispatch(clearPendingTab());
    setPendingNavigationUrl(null);
  };

  const industryOptions = [
    { value: "", label: "Not specified" },
    ...(reference?.industries ?? []).map((item) => ({
      value: item.code,
      label: item.label,
    })),
  ];

  // Document status lookups
  const findDocument = (type: string) => company.documents?.find((d) => d.docType === type);
  const panDoc = findDocument("doc_pan");
  const regDoc = findDocument("doc_registration");
  const gstDoc = findDocument("doc_gst");
  const authDoc = findDocument("doc_authorisation");

  const showUnsavedDialog = Boolean(pendingTab || pendingNavigationUrl);

  return (
    <div className="w-full space-y-6 pb-24">
      {/* Top Header Card */}
      <div className="flex flex-col gap-4 rounded-xl border border-[#e0e4e9] bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <Building2 className="h-5 w-5 text-[#3566b8]" aria-hidden="true" />
            <h1 className="text-base font-bold text-[#111827]">Company profile</h1>
          </div>
          <p className="mt-1 text-xs text-[#687386]">
            Public details for jobseekers and verified compliance records.
          </p>
        </div>
        <div>
          <StatusBadge status={company.kybStatus || "DRAFT"} />
        </div>
      </div>

      {(isOrgError || isKybError) && (
        <EmployerErrorState
          className="mb-2"
          fallback="Unable to load complete company details. Please try again."
        />
      )}

      {/* Changes a reviewer asked for, or a rejection to start again from */}
      {isOwner && kyb && <KybChangesPanel kyb={kyb} />}

      {/* 1. PUBLIC PROFILE (Editable directly) */}
      <section className="rounded-xl border border-[#e0e4e9] bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 border-b border-[#eef2f6] pb-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-bold text-[#111827] flex items-center gap-2">
              Public company profile
            </h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-[#ecfdf3] px-2.5 py-0.5 text-[11px] font-semibold text-[#027a48]">
              Editable directly
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[#687386]">
            How candidates will recognise your organisation. You can change these at any
            time without re-verification.
          </p>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="trade-name" className="mb-1.5 block text-[12px] font-semibold text-[#303747]">
                Trade name / Brand name
              </label>
              <input
                id="trade-name"
                type="text"
                maxLength={255}
                value={company.tradeName}
                onChange={update("tradeName")}
                placeholder="e.g. Acme Tech (leave blank if same as legal name)"
                className={inputClass}
              />
              <p className="mt-1 text-[11px] text-[#718096]">
                The brand name candidates recognise on listings.
              </p>
            </div>

            <div>
              <label id="industry-label" className="mb-1.5 block text-[12px] font-semibold text-[#303747]">
                Sector / Industry
              </label>
              <AppSelect
                value={company.industry}
                onChange={updateValue("industry")}
                options={industryOptions}
                placeholder="Select sector"
                ariaLabel="Industry"
                className={selectClass}
                searchable
                searchPlaceholder="Search sectors"
              />
              <p className="mt-1 text-[11px] text-[#718096]">
                Used by candidates to filter listings.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label id="company-size-label" className="mb-1.5 block text-[12px] font-semibold text-[#303747]">
                Company size (Headcount)
              </label>
              <AppSelect
                value={company.employeeCountBand}
                onChange={updateValue("employeeCountBand")}
                options={EMPLOYEE_COUNT_OPTIONS}
                placeholder="Select headcount band"
                ariaLabel="Company size"
                className={selectClass}
              />
            </div>

            <div>
              <label htmlFor="company-website" className="mb-1.5 block text-[12px] font-semibold text-[#303747]">
                Website
              </label>
              <div className="relative">
                <Globe
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa2b1]"
                  aria-hidden="true"
                />
                <input
                  id="company-website"
                  type="url"
                  value={company.website}
                  onChange={update("website")}
                  placeholder="https://yourcompany.in"
                  className={`${inputClass} pl-9 ${validationErrors.website ? "border-[#e5484d] ring-1 ring-[#e5484d]" : ""}`}
                />
              </div>
              {validationErrors.website && (
                <p className="mt-1 text-xs text-[#b42318]">{validationErrors.website}</p>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="company-about" className="mb-1.5 block text-[12px] font-semibold text-[#303747]">
              About organisation
            </label>
            <textarea
              id="company-about"
              rows={3}
              maxLength={1000}
              value={company.about}
              onChange={update("about")}
              placeholder="What does your organisation do? Share a brief description for candidates..."
              className="w-full rounded-[9px] border border-[#dfe4ea] bg-white p-3 text-[13px] text-[#111827] outline-none transition placeholder:text-[#9aa2b1] focus:border-[#3566b8] focus:ring-4 focus:ring-[#3566b8]/10"
            />
            <p className="mt-1 text-[11px] text-[#718096]">
              Two or three sentences describing what you do and your mission.
            </p>
          </div>

        </div>
      </section>

      {/* 2. LEGAL & REGISTRATION (Read-only / Locked, or fillable if optional & not provided) */}
      <section className="rounded-xl border border-[#e0e4e9] bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 border-b border-[#eef2f6] pb-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-bold text-[#111827] flex items-center gap-2">
              Legal &amp; Business Registration
            </h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-[#f1f5f9] px-2.5 py-0.5 text-[11px] font-medium text-[#475569]">
              <Lock className="h-3 w-3" aria-hidden="true" />
              Verified &amp; Protected
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[#687386]">
            From your business verification, as submitted for review. They change only
            through verification, never from this page.{" "}
            {needsVerificationChanges(kyb)
              ? "Update them from the verification panel at the top of this page."
              : "Contact support to correct them."}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Registered Organisation Name - Always locked */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[12px] font-semibold text-[#475467]">Registered organisation name</label>
              <span className="inline-flex items-center gap-1 text-[11px] text-[#8592a6]">
                <Lock className="h-3 w-3" /> Locked
              </span>
            </div>
            <input
              type="text"
              readOnly
              disabled
              value={company.legalName || "—"}
              className={lockedInputClass}
            />
            <p className="mt-1 text-[11px] text-[#718096]">Matches your PAN or registration certificate.</p>
          </div>

          {/* Organisation Type - Always locked */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[12px] font-semibold text-[#475467]">Organisation type</label>
              <span className="inline-flex items-center gap-1 text-[11px] text-[#8592a6]">
                <Lock className="h-3 w-3" /> Locked
              </span>
            </div>
            <input
              type="text"
              readOnly
              disabled
              value={getEmployerTypeLabel(company.businessType, reference?.employer_types)}
              className={lockedInputClass}
            />
          </div>

          {(
            [
              ["PAN", company.pan],
              ["GSTIN", company.gstin],
              ["CIN / LLPIN", company.cin],
              ["TAN", company.tan],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[12px] font-semibold text-[#475467]">{label}</label>
                <span className="inline-flex items-center gap-1 text-[11px] text-[#8592a6]">
                  <Lock className="h-3 w-3" /> From KYB
                </span>
              </div>
              <input
                type="text"
                readOnly
                disabled
                aria-label={label}
                value={value || "Not provided"}
                className={lockedInputClass}
              />
            </div>
          ))}
        </div>

        {/* KYB Registered Address - Always locked */}
        <div className="mt-4 border-t border-[#f1f4f8] pt-4">
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[12px] font-semibold text-[#475467]">KYB Registered Address</label>
            <span className="inline-flex items-center gap-1 text-[11px] text-[#8592a6]">
              <Lock className="h-3 w-3" /> Locked
            </span>
          </div>
          <input
            type="text"
            readOnly
            disabled
            value={company.address || "—"}
            className={lockedInputClass}
          />
          <p className="mt-1 text-[11px] text-[#718096]">Official registered address verified against registration documents.</p>
        </div>
      </section>

      {/* 3. AUTHORISED SIGNATORY (Read-only / Locked) */}
      <section className="rounded-xl border border-[#e0e4e9] bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 border-b border-[#eef2f6] pb-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-bold text-[#111827] flex items-center gap-2">
              Authorised Signatory &amp; Contact
            </h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-[#f1f5f9] px-2.5 py-0.5 text-[11px] font-medium text-[#475569]">
              <Lock className="h-3 w-3" aria-hidden="true" />
              Verified contact
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[#687386]">
            Authorised representative responsible for business verification.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[12px] font-semibold text-[#475467]">Authorised person&apos;s name</label>
              <span className="inline-flex items-center gap-1 text-[11px] text-[#8592a6]">
                <Lock className="h-3 w-3" /> Locked
              </span>
            </div>
            <input type="text" readOnly disabled value={company.signatoryName || "—"} className={lockedInputClass} />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[12px] font-semibold text-[#475467]">Designation</label>
              <span className="inline-flex items-center gap-1 text-[11px] text-[#8592a6]">
                <Lock className="h-3 w-3" /> Locked
              </span>
            </div>
            <input type="text" readOnly disabled value={company.signatoryDesignation || "—"} className={lockedInputClass} />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[12px] font-semibold text-[#475467]">Official work email</label>
              <span className="inline-flex items-center gap-1 text-[11px] text-[#8592a6]">
                <Lock className="h-3 w-3" /> Locked
              </span>
            </div>
            <input type="text" readOnly disabled value={company.workEmail || "—"} className={lockedInputClass} />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[12px] font-semibold text-[#475467]">Contact mobile number</label>
              <span className="inline-flex items-center gap-1 text-[11px] text-[#8592a6]">
                <Lock className="h-3 w-3" /> Locked
              </span>
            </div>
            <input type="text" readOnly disabled value={company.workPhone || "—"} className={lockedInputClass} />
          </div>
        </div>
      </section>

      {/* 4. VERIFICATION DOCUMENTS (Read-only / Locked) */}
      <section className="rounded-xl border border-[#e0e4e9] bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4 border-b border-[#eef2f6] pb-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-bold text-[#111827] flex items-center gap-2">
              Verification Documents
            </h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-[#f1f5f9] px-2.5 py-0.5 text-[11px] font-medium text-[#475569]">
              <Lock className="h-3 w-3" aria-hidden="true" />
              Verified records
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[#687386]">
            Document records uploaded during KYB verification.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-center justify-between rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3">
            <div className="flex items-center gap-2.5">
              <FileCheck2 className={`h-4 w-4 ${panDoc ? "text-[#1f7a63]" : "text-[#94a3b8]"}`} />
              <span className="text-xs font-semibold text-[#1e293b]">PAN Document</span>
            </div>
            {panDoc ? (
              <OnFileChip onView={() => viewDocument("doc_pan")} />
            ) : (
              <span className="text-[11px] text-[#64748b]">Not submitted</span>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3">
            <div className="flex items-center gap-2.5">
              <FileCheck2 className={`h-4 w-4 ${regDoc ? "text-[#1f7a63]" : "text-[#94a3b8]"}`} />
              <span className="text-xs font-semibold text-[#1e293b]">Certificate of Incorporation</span>
            </div>
            {regDoc ? (
              <OnFileChip onView={() => viewDocument("doc_registration")} />
            ) : (
              <span className="text-[11px] text-[#64748b]">Optional • None</span>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3">
            <div className="flex items-center gap-2.5">
              <FileCheck2 className={`h-4 w-4 ${gstDoc ? "text-[#1f7a63]" : "text-[#94a3b8]"}`} />
              <span className="text-xs font-semibold text-[#1e293b]">GST Registration</span>
            </div>
            {gstDoc ? (
              <OnFileChip onView={() => viewDocument("doc_gst")} />
            ) : (
              <span className="text-[11px] text-[#64748b]">Optional • None</span>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3">
            <div className="flex items-center gap-2.5">
              <FileCheck2 className={`h-4 w-4 ${authDoc ? "text-[#1f7a63]" : "text-[#94a3b8]"}`} />
              <span className="text-xs font-semibold text-[#1e293b]">Authorisation Letter</span>
            </div>
            {authDoc ? (
              <OnFileChip onView={() => viewDocument("doc_authorisation")} />
            ) : (
              <span className="text-[11px] text-[#64748b]">Optional • None</span>
            )}
          </div>
        </div>
      </section>

      {isOwner && kyb && kyb.reviews.length > 0 && (
        <section className="rounded-xl border border-[#e0e4e9] bg-white p-5 shadow-sm sm:p-6">
          <KybReviewHistory form={kybForm} reviews={kyb.reviews} />
        </section>
      )}

      {/* 5. LEGAL & COMPLIANCE UNDERTAKINGS (Collapsible) */}
      <section className="rounded-xl border border-[#e0e4e9] bg-white shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setShowUndertakings(!showUndertakings)}
          className="flex w-full cursor-pointer items-center justify-between bg-white px-5 py-4 text-left transition hover:bg-[#f8fafc]"
        >
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 text-[#3566b8]" aria-hidden="true" />
            <div>
              <span className="text-[13px] font-bold text-[#111827]">
                Legal &amp; Compliance Undertakings
              </span>
              <p className="text-[11px] text-[#64748b]">
                Platform terms, as given in your business verification
              </p>
            </div>
          </div>
          {showUndertakings ? (
            <ChevronUp className="h-4 w-4 text-[#64748b]" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[#64748b]" />
          )}
        </button>

        {showUndertakings && (
          <div className="border-t border-[#f1f4f8] bg-[#fbfcfd] p-5 space-y-3">
            {(
              [
                [
                  company.undertakings.genuineHiring,
                  "Genuine hiring",
                  "We will use candidate details only to contact people about genuine jobs.",
                ],
                [
                  company.undertakings.noRedistribution,
                  "No data redistribution",
                  "We will not sell, share or publish candidate details.",
                ],
                [
                  company.undertakings.authorised,
                  "Authorised representation",
                  "I am authorised to accept these terms for this organisation.",
                ],
              ] as const
            ).map(([accepted, title, words]) => (
              <div key={title} className="flex items-start gap-3 text-xs text-[#334155]">
                {accepted ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#027a48]" aria-label="Accepted" />
                ) : (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#94a3b8]" aria-label="Not yet accepted" />
                )}
                <span>
                  <strong>{title}:</strong> {words}
                  {accepted ? null : (
                    <span className="ml-1 text-[#64748b]">(not yet accepted)</span>
                  )}
                </span>
              </div>
            ))}
            {company.undertakings?.submittedAt && (
              <p className="mt-2 text-[11px] text-[#64748b] border-t border-[#f1f4f8] pt-2">
                Agreed on:{" "}
                {new Date(company.undertakings.submittedAt).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
            )}
          </div>
        )}
      </section>

      {/* 6. SAVE BUTTON BAR AT END OF PAGE */}
      <div className="sticky bottom-4 z-20 flex w-full flex-col gap-3 rounded-xl border border-[#dfe3e8] bg-white/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          {isDirty ? (
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#f97316] opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#ea580c]" />
              </span>
              <div>
                <p className="text-[13px] font-semibold text-[#111827]">You have unsaved changes</p>
                <p className="text-[11px] text-[#687386]">Save to keep your changes.</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#027a48]" />
              <p className="text-[13px] font-medium text-[#475467]">All changes saved and up to date</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3">
          {saveError ? (
            <EmployerErrorState
              variant="inline"
              error={saveError}
              fallback="Your changes were not saved. Please try again."
            />
          ) : null}
          <button
            type="button"
            disabled={!isDirty || isSaving || !isOwner}
            onClick={() => void handleSave()}
            className={`inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg px-5 text-xs font-semibold shadow-sm transition ${
              isDirty && !isSaving
                ? "bg-[#3566b8] text-white hover:bg-[#285299] ring-2 ring-[#3566b8]/20"
                : "cursor-not-allowed bg-[#f1f4f8] text-[#9aa2b1]"
            }`}
          >
            {isSaving && <Loader2 aria-hidden="true" size={14} className="animate-spin" />}
            {isSaving ? "Saving changes…" : "Save changes"}
          </button>
        </div>
      </div>

      <section className="rounded-xl border border-[#e0e4e9] bg-white p-5 shadow-sm sm:p-6">
        <h2 className="m-0 text-[13px] font-bold leading-[18px]">Password</h2>
        <p className="mt-0.5 mb-3 text-xs leading-4 text-[#718096]">
          Change the password you use to sign in
        </p>
        <button
          type="button"
          onClick={() => setPasswordOpen(true)}
          className="min-h-9 cursor-pointer rounded-lg border border-[#d6dbe2] bg-white px-3.5 text-xs font-bold text-[#172033]"
        >
          Change password
        </button>
        <div className="mt-4">
          <MfaSettingsControl />
        </div>
      </section>

      <ChangePasswordModal
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        theme="employer"
        pool="BUSINESS"
      />

      {/* 7. UNSAVED CHANGES POPUP CONFIRMATION MODAL */}
      <ConfirmModal
        open={showUnsavedDialog}
        title="You have unsaved changes"
        description="You have made changes to your company profile that have not been saved yet. If you leave without saving, your changes will be discarded. Please save your changes."
        confirmLabel="Leave without saving"
        cancelLabel="Stay and save"
        tone="danger"
        onClose={handleStayOnPage}
        onConfirm={handleDiscardAndLeave}
      />
    </div>
  );
}
