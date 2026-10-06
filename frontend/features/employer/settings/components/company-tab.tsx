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
  Lock,
  Loader2,
  ShieldCheck,
} from "lucide-react";

import { AppSelect } from "@/components/ui/app-select";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Skeleton } from "@/components/common/loading";
import { EmployerErrorState } from "@/features/employer/components/employer-error-state";
import { INDIAN_STATES } from "@/features/student/onboarding/constants";
import { useGetEmployerKybQuery } from "@/store/employer/kyb";
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
} from "@/store/employer/settings";
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

// Official statutory identifier regex patterns from backend (app/core/forms.py)
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const CIN_REGEX = /^([LUu][0-9]{5}[A-Za-z]{2}[0-9]{4}[A-Za-z]{3}[0-9]{6}|[A-Za-z0-9-]{7,21})$/;
const TAN_REGEX = /^[A-Z]{4}[0-9]{5}[A-Z]$/;
const URL_REGEX = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/.*)?$/;

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
  } = useGetEmployerKybQuery();

  const { data: reference } = useGetEmployerReferenceQuery();
  const [updateOrganisation, { isLoading: isSaving }] =
    useUpdateEmployerOrganisationMutation();

  const [showUndertakings, setShowUndertakings] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [initiallyFilledKeys, setInitiallyFilledKeys] = useState<Set<string>>(new Set());

  // Holds the baseline values when page is loaded or last saved, to calculate isDirty
  const baselineRef = useRef<CompanyProfile | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Link navigation intercept state
  const [pendingNavigationUrl, setPendingNavigationUrl] = useState<string | null>(null);

  // Initialize and load baseline data
  useEffect(() => {
    if (!organisation && !kyb) return;

    const kybAnswers = (kyb?.answers ?? {}) as Record<string, unknown>;
    const kybDocs = (kyb?.documents ?? []).map((doc) => ({
      docType: doc.docType,
      mime: doc.mime,
      uploadedAt: doc.uploadedAt,
    }));

    // Read stored profile modifications from localStorage if available
    let savedLocal: Partial<CompanyProfile> = {};
    let savedLockedKeys: string[] = [];
    try {
      const stored = localStorage.getItem("bharatpath_employer_custom_profile");
      if (stored) savedLocal = JSON.parse(stored);
      const storedLocked = localStorage.getItem("bharatpath_employer_locked_fields");
      if (storedLocked) savedLockedKeys = JSON.parse(storedLocked);
    } catch {
      // Ignore parse errors
    }

    // Determine which fields were already filled at onboarding / previously
    const filled = new Set<string>(savedLockedKeys);
    if ((organisation?.legalName || kybAnswers.legal_name)?.toString().trim()) filled.add("legalName");
    if ((organisation?.businessType || kybAnswers.employer_type)?.toString().trim()) filled.add("businessType");
    if (kybAnswers.pan?.toString().trim()) filled.add("pan");
    if (kybAnswers.gstin?.toString().trim()) filled.add("gstin");
    if (kybAnswers.cin?.toString().trim()) filled.add("cin");
    if (kybAnswers.tan?.toString().trim()) filled.add("tan");
    if (kybAnswers.signatory_name?.toString().trim()) filled.add("signatoryName");
    if (kybAnswers.signatory_designation?.toString().trim()) filled.add("signatoryDesignation");
    if (kybAnswers.work_email?.toString().trim()) filled.add("workEmail");
    if (kybAnswers.work_phone?.toString().trim()) filled.add("workPhone");
    if (kybAnswers.address_line1?.toString().trim()) filled.add("address");

    setInitiallyFilledKeys(filled);

    const stateName = getStateName((kybAnswers.state as string) || "");
    const addressComponents = [
      (kybAnswers.address_line1 as string) || "",
      (kybAnswers.address_line2 as string) || "",
      (kybAnswers.city as string) || "",
      stateName,
      (kybAnswers.pincode as string) || "",
    ].filter(Boolean);
    const formattedAddress = addressComponents.join(", ");

    const initialCompany: CompanyProfile = {
      legalName: organisation?.legalName || (kybAnswers.legal_name as string) || "",
      businessType: organisation?.businessType || (kybAnswers.employer_type as string) || "",
      industry: organisation?.industry || (kybAnswers.industry as string) || "",
      kybStatus: organisation?.kybStatus || kyb?.state || "DRAFT",
      pan: (kybAnswers.pan as string) || savedLocal.pan || "",
      gstin: (kybAnswers.gstin as string) || savedLocal.gstin || "",
      cin: (kybAnswers.cin as string) || savedLocal.cin || "",
      tan: (kybAnswers.tan as string) || savedLocal.tan || "",
      address: formattedAddress || "",
      addressLine1: (kybAnswers.address_line1 as string) || "",
      addressLine2: (kybAnswers.address_line2 as string) || "",
      city: (kybAnswers.city as string) || "",
      state: stateName,
      pincode: (kybAnswers.pincode as string) || "",
      signatoryName: (kybAnswers.signatory_name as string) || "",
      signatoryDesignation: (kybAnswers.signatory_designation as string) || "",
      workEmail: (kybAnswers.work_email as string) || "",
      workPhone: (kybAnswers.work_phone as string) || "",
      documents: kybDocs,
      undertakings: {
        genuineHiring: Boolean(kybAnswers.undertaking_genuine_hiring ?? true),
        noRedistribution: Boolean(kybAnswers.undertaking_no_redistribution ?? true),
        authorised: Boolean(kybAnswers.undertaking_authorised ?? true),
        submittedAt: kyb?.submittedAt ?? null,
      },

      tradeName: savedLocal.tradeName ?? (kybAnswers.trade_name as string) ?? "",
      employeeCountBand: savedLocal.employeeCountBand ?? (kybAnswers.employee_count_band as string) ?? "",
      website: savedLocal.website ?? (kybAnswers.website as string) ?? "",
      about: savedLocal.about ?? (kybAnswers.about as string) ?? "",
      hasSeparateCorrespondenceAddress: savedLocal.hasSeparateCorrespondenceAddress ?? false,
      correspondenceAddress: savedLocal.correspondenceAddress ?? "",
    };

    baselineRef.current = initialCompany;
    dispatch(replaceCompanyProfile(initialCompany));
    setIsDirty(false);
    dispatch(setHasUnsavedChanges(false));
  }, [dispatch, organisation, kyb]);

  // Compute dirty state whenever company values change
  useEffect(() => {
    if (!baselineRef.current) return;
    const b = baselineRef.current;

    const changed =
      company.tradeName !== b.tradeName ||
      company.industry !== b.industry ||
      company.employeeCountBand !== b.employeeCountBand ||
      company.website !== b.website ||
      company.about !== b.about ||
      company.hasSeparateCorrespondenceAddress !== b.hasSeparateCorrespondenceAddress ||
      company.correspondenceAddress !== b.correspondenceAddress ||
      company.pan !== b.pan ||
      company.gstin !== b.gstin ||
      company.cin !== b.cin ||
      company.tan !== b.tan;

    setIsDirty(changed);
    dispatch(setHasUnsavedChanges(changed));
  }, [company, dispatch]);

  // Handle browser beforeunload alert when changes exist
  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

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
    (field: keyof CompanyProfile) =>
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

  const updateUpper =
    (field: keyof CompanyProfile) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const upperVal = event.target.value.replace(/\s/g, "").toUpperCase();
      dispatch(updateCompanyField({ field, value: upperVal }));

      if (validationErrors[field]) {
        setValidationErrors((prev) => {
          const next = { ...prev };
          delete next[field];
          return next;
        });
      }
    };

  const updateCheckbox =
    (field: keyof CompanyProfile) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      dispatch(updateCompanyField({ field, value: event.target.checked }));
    };

  const updateValue = (field: keyof CompanyProfile) => (value: string) => {
    dispatch(updateCompanyField({ field, value }));
  };

  const validateAll = (): boolean => {
    const errors: Record<string, string> = {};

    // Validate newly filled PAN
    if (!initiallyFilledKeys.has("pan") && company.pan?.trim()) {
      if (!PAN_REGEX.test(company.pan.trim())) {
        errors.pan = "PAN must be 10 characters (e.g. ABCDE1234F: 5 letters, 4 digits, 1 letter).";
      }
    }

    // Validate newly filled GSTIN
    if (!initiallyFilledKeys.has("gstin") && company.gstin?.trim()) {
      if (!GSTIN_REGEX.test(company.gstin.trim())) {
        errors.gstin = "GSTIN must be 15 characters (e.g. 29ABCDE1234F1Z5: 2 digit state code, 10 char PAN, 1 entity digit, Z, checksum).";
      }
    }

    // Validate newly filled CIN
    if (!initiallyFilledKeys.has("cin") && company.cin?.trim()) {
      if (!CIN_REGEX.test(company.cin.trim())) {
        errors.cin = "Enter a valid 21-character Corporate Identity Number (e.g. U72900KA2020PTC123456) or LLPIN.";
      }
    }

    // Validate newly filled TAN
    if (!initiallyFilledKeys.has("tan") && company.tan?.trim()) {
      if (!TAN_REGEX.test(company.tan.trim())) {
        errors.tan = "TAN must be 10 characters (e.g. BLRB12345C: 4 letters, 5 digits, 1 letter).";
      }
    }

    // Validate Website if provided
    if (company.website?.trim() && !URL_REGEX.test(company.website.trim())) {
      errors.website = "Enter a valid website URL (e.g. https://yourcompany.in).";
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = () => {
    if (!validateAll()) return;

    // 1. Send editable industry to backend
    if (company.industry) {
      void updateOrganisation({
        industry: company.industry,
      })
        .unwrap()
        .catch(() => undefined);
    }

    // 2. Identify newly filled identifier fields to permanently lock them
    const nextLocked = new Set(initiallyFilledKeys);
    if (company.pan?.trim()) nextLocked.add("pan");
    if (company.gstin?.trim()) nextLocked.add("gstin");
    if (company.cin?.trim()) nextLocked.add("cin");
    if (company.tan?.trim()) nextLocked.add("tan");

    setInitiallyFilledKeys(nextLocked);

    // 3. Persist to localStorage
    try {
      localStorage.setItem("bharatpath_employer_locked_fields", JSON.stringify(Array.from(nextLocked)));
      localStorage.setItem(
        "bharatpath_employer_custom_profile",
        JSON.stringify({
          tradeName: company.tradeName,
          industry: company.industry,
          employeeCountBand: company.employeeCountBand,
          website: company.website,
          about: company.about,
          hasSeparateCorrespondenceAddress: company.hasSeparateCorrespondenceAddress,
          correspondenceAddress: company.correspondenceAddress,
          pan: company.pan,
          gstin: company.gstin,
          cin: company.cin,
          tan: company.tan,
        }),
      );
    } catch {
      // Ignore quota exceptions
    }

    // 4. Update baseline and reset dirty
    baselineRef.current = { ...company };
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
            These details are displayed on your job posts and candidate-facing pages.
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
              value={company.about}
              onChange={update("about")}
              placeholder="What does your organisation do? Share a brief description for candidates..."
              className="w-full rounded-[9px] border border-[#dfe4ea] bg-white p-3 text-[13px] text-[#111827] outline-none transition placeholder:text-[#9aa2b1] focus:border-[#3566b8] focus:ring-4 focus:ring-[#3566b8]/10"
            />
            <p className="mt-1 text-[11px] text-[#718096]">
              Two or three sentences describing what you do and your mission.
            </p>
          </div>

          <div className="rounded-lg border border-[#eef2f6] bg-[#f8fafc] p-3.5">
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={company.hasSeparateCorrespondenceAddress}
                onChange={updateCheckbox("hasSeparateCorrespondenceAddress")}
                className="mt-0.5 h-4 w-4 rounded border-[#ccd3df] text-[#3566b8] focus:ring-[#3566b8]"
              />
              <div className="text-[12px]">
                <span className="font-semibold text-[#172033]">
                  Provide a separate public office / correspondence address
                </span>
                <p className="mt-0.5 text-[#687386]">
                  Check this if your candidate-facing office is different from your KYB registered address.
                </p>
              </div>
            </label>

            {company.hasSeparateCorrespondenceAddress && (
              <div className="mt-3">
                <textarea
                  rows={2}
                  value={company.correspondenceAddress}
                  onChange={update("correspondenceAddress")}
                  placeholder="Enter street, building, city, state and PIN code for correspondence"
                  className="w-full rounded-[8px] border border-[#dfe4ea] bg-white p-2.5 text-[12px] text-[#111827] outline-none focus:border-[#3566b8]"
                />
              </div>
            )}
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
            Credentials collected during business verification. Once recorded, these fields are permanently locked.
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

          {/* PAN - Locked if filled; fillable if missing */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[12px] font-semibold text-[#475467]">PAN</label>
              {initiallyFilledKeys.has("pan") ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-[#8592a6]">
                  <Lock className="h-3 w-3" /> Locked
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded bg-[#fff7ed] px-2 py-0.5 text-[10px] font-semibold text-[#c2410c]">
                  Fillable once
                </span>
              )}
            </div>
            {initiallyFilledKeys.has("pan") ? (
              <input type="text" readOnly disabled value={company.pan} className={lockedInputClass} />
            ) : (
              <div>
                <input
                  type="text"
                  maxLength={10}
                  value={company.pan}
                  onChange={updateUpper("pan")}
                  placeholder="ABCDE1234F"
                  className={`${inputClass} ${validationErrors.pan ? "border-[#e5484d] ring-1 ring-[#e5484d]" : ""}`}
                />
                {validationErrors.pan && (
                  <p className="mt-1 text-xs text-[#b42318]">{validationErrors.pan}</p>
                )}
                <p className="mt-1 text-[11px] text-[#718096]">Permanent Account Number (10 alphanumeric characters).</p>
              </div>
            )}
          </div>

          {/* GSTIN - Locked if filled; fillable if optional & not provided */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[12px] font-semibold text-[#475467]">GSTIN</label>
              {initiallyFilledKeys.has("gstin") ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-[#8592a6]">
                  <Lock className="h-3 w-3" /> Locked
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded bg-[#fff7ed] px-2 py-0.5 text-[10px] font-semibold text-[#c2410c]">
                  Fillable once
                </span>
              )}
            </div>
            {initiallyFilledKeys.has("gstin") ? (
              <input type="text" readOnly disabled value={company.gstin || "Not registered"} className={lockedInputClass} />
            ) : (
              <div>
                <input
                  type="text"
                  maxLength={15}
                  value={company.gstin}
                  onChange={updateUpper("gstin")}
                  placeholder="29ABCDE1234F1Z5"
                  className={`${inputClass} ${validationErrors.gstin ? "border-[#e5484d] ring-1 ring-[#e5484d]" : ""}`}
                />
                {validationErrors.gstin && (
                  <p className="mt-1 text-xs text-[#b42318]">{validationErrors.gstin}</p>
                )}
                <p className="mt-1 text-[11px] text-[#718096]">15 characters statutory format. Once saved, this cannot be altered.</p>
              </div>
            )}
          </div>

          {/* CIN / LLPIN - Locked if filled; fillable if optional & not provided */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[12px] font-semibold text-[#475467]">CIN / LLPIN</label>
              {initiallyFilledKeys.has("cin") ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-[#8592a6]">
                  <Lock className="h-3 w-3" /> Locked
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded bg-[#fff7ed] px-2 py-0.5 text-[10px] font-semibold text-[#c2410c]">
                  Fillable once
                </span>
              )}
            </div>
            {initiallyFilledKeys.has("cin") ? (
              <input type="text" readOnly disabled value={company.cin || "Not applicable"} className={lockedInputClass} />
            ) : (
              <div>
                <input
                  type="text"
                  maxLength={21}
                  value={company.cin}
                  onChange={updateUpper("cin")}
                  placeholder="U72900KA2020PTC123456"
                  className={`${inputClass} ${validationErrors.cin ? "border-[#e5484d] ring-1 ring-[#e5484d]" : ""}`}
                />
                {validationErrors.cin && (
                  <p className="mt-1 text-xs text-[#b42318]">{validationErrors.cin}</p>
                )}
                <p className="mt-1 text-[11px] text-[#718096]">21 characters for companies or valid LLPIN. Once saved, cannot be altered.</p>
              </div>
            )}
          </div>

          {/* TAN - Locked if filled; fillable if optional & not provided */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[12px] font-semibold text-[#475467]">TAN</label>
              {initiallyFilledKeys.has("tan") ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-[#8592a6]">
                  <Lock className="h-3 w-3" /> Locked
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded bg-[#fff7ed] px-2 py-0.5 text-[10px] font-semibold text-[#c2410c]">
                  Fillable once
                </span>
              )}
            </div>
            {initiallyFilledKeys.has("tan") ? (
              <input type="text" readOnly disabled value={company.tan || "Not provided"} className={lockedInputClass} />
            ) : (
              <div>
                <input
                  type="text"
                  maxLength={10}
                  value={company.tan}
                  onChange={updateUpper("tan")}
                  placeholder="BLRB12345C"
                  className={`${inputClass} ${validationErrors.tan ? "border-[#e5484d] ring-1 ring-[#e5484d]" : ""}`}
                />
                {validationErrors.tan && (
                  <p className="mt-1 text-xs text-[#b42318]">{validationErrors.tan}</p>
                )}
                <p className="mt-1 text-[11px] text-[#718096]">10-character Tax Deduction Account Number.</p>
              </div>
            )}
          </div>
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
              <span className="inline-flex items-center gap-1 rounded bg-[#ecfdf3] px-2 py-0.5 text-[11px] font-medium text-[#027a48]">
                <CheckCircle2 className="h-3 w-3" /> On file
              </span>
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
              <span className="inline-flex items-center gap-1 rounded bg-[#ecfdf3] px-2 py-0.5 text-[11px] font-medium text-[#027a48]">
                <CheckCircle2 className="h-3 w-3" /> On file
              </span>
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
              <span className="inline-flex items-center gap-1 rounded bg-[#ecfdf3] px-2 py-0.5 text-[11px] font-medium text-[#027a48]">
                <CheckCircle2 className="h-3 w-3" /> On file
              </span>
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
              <span className="inline-flex items-center gap-1 rounded bg-[#ecfdf3] px-2 py-0.5 text-[11px] font-medium text-[#027a48]">
                <CheckCircle2 className="h-3 w-3" /> On file
              </span>
            ) : (
              <span className="text-[11px] text-[#64748b]">Optional • None</span>
            )}
          </div>
        </div>
      </section>

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
                Platform terms accepted during onboarding
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
            <div className="flex items-start gap-3 text-xs text-[#334155]">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#027a48]" />
              <span>
                <strong>Genuine hiring:</strong> We will use candidate details only to contact people about genuine jobs.
              </span>
            </div>
            <div className="flex items-start gap-3 text-xs text-[#334155]">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#027a48]" />
              <span>
                <strong>No data redistribution:</strong> We will not sell, share or publish candidate details.
              </span>
            </div>
            <div className="flex items-start gap-3 text-xs text-[#334155]">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#027a48]" />
              <span>
                <strong>Authorised representation:</strong> I am authorised to accept these terms for this organisation.
              </span>
            </div>
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
                <p className="text-[11px] text-[#687386]">Please save to persist updates and lock any newly filled identifiers.</p>
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
          <button
            type="button"
            disabled={!isDirty || isSaving}
            onClick={handleSave}
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
