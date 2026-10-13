"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import { Button, SelectDropdown } from "@/components/ui";
import { AppSelect } from "@/components/ui/app-select";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { INSTITUTION_TYPES } from "@/features/college/onboarding/institution-types";
import { INDIAN_STATES } from "@/features/student/onboarding/constants";
import { KybFieldInput } from "@/features/employer/onboarding/components/kyb-field";
import { problemParam, validateField, wireValue } from "@/features/employer/onboarding/kyb-form";
import { getApiErrorCode, getApiErrorMessage } from "@/lib/api/error-message";
import { showFormError } from "@/lib/feedback/form-error";
import { showAdminFeedback } from "@/store/admin";
import {
  useProvisionAdminCandidateMutation,
  useProvisionAdminCollegeMutation,
  useProvisionAdminEmployerMutation,
  useGetAdminAccountFormsQuery,
  useInviteAdminAccountMutation,
} from "@/store/api/admin-api";
import type { AdminAccountForm, AdminAccountFormField } from "@/store/api/admin-api";
import { useGetEmployerReferenceQuery } from "@/store/employer/settings/settings.api";
import { useAppDispatch } from "@/store/hooks";

import {
  FieldError,
  FormField,
  INPUT_HEIGHT,
  a11y,
  hasErrors,
  inputClass,
  validateEmail,
  validateName,
  validateOptionalText,
} from "../../shared/form";
import type { UserSegment } from "../types";

interface CreateUserDrawerProps {
  /** Fixes which kind of account this drawer creates. */
  segment: UserSegment;
  mode: "create" | "invite";
  onClose: () => void;
}

const DROPDOWN_CLASS = "rounded-lg focus:border-[#315c9f] focus:ring-[#315c9f]/20";

const PREFILL_EXCLUDED: Record<UserSegment, ReadonlySet<string>> = {
  candidates: new Set(),
  employers: new Set(["legal_name", "employer_type", "industry"]),
  institutions: new Set(["legal_name", "institution_type"]),
};

const CREATE_COPY = {
  candidates: {
    title: "Create candidate",
    description:
      "Creates the candidate's account and emails them a temporary password, valid for 7 days.",
  },
  employers: {
    title: "Create employer",
    description:
      "Creates the organisation and its owner. The owner still completes KYB and subscribes.",
  },
  institutions: {
    title: "Create institution",
    description:
      "Creates the institution and its administrator. They complete onboarding and subscribe themselves.",
  },
} satisfies Record<UserSegment, { title: string; description: string }>;

const EMAIL_LABEL = {
  candidates: "Email address",
  employers: "Owner email",
  institutions: "Administrator email",
} satisfies Record<UserSegment, string>;

export function CreateUserDrawer({ segment, mode, onClose }: CreateUserDrawerProps) {
  useScrollLock(true);
  const dispatch = useAppDispatch();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [employerType, setEmployerType] = useState("");
  const [industry, setIndustry] = useState("");
  const [institutionType, setInstitutionType] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [draftAnswers, setDraftAnswers] = useState<Record<string, unknown>>({});
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  // Refusals from the server, keyed like `errors`; cleared when the field changes.
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  const [provisionCandidate, candidateState] = useProvisionAdminCandidateMutation();
  const [provisionEmployer, employerState] = useProvisionAdminEmployerMutation();
  const [provisionCollege, collegeState] = useProvisionAdminCollegeMutation();
  const [inviteAccount, inviteState] = useInviteAdminAccountMutation();
  const reference = useGetEmployerReferenceQuery(undefined, {
    skip: mode === "invite" || segment !== "employers",
  });
  const accountForms = useGetAdminAccountFormsQuery(undefined, {
    skip: mode === "invite" || segment === "candidates",
  });
  const isLoading =
    candidateState.isLoading || employerState.isLoading || collegeState.isLoading || inviteState.isLoading;
  const noun = segment === "candidates" ? "candidate" : segment === "employers" ? "employer" : "institution";
  const copy = mode === "invite"
    ? { title: `Invite ${noun}`, description: `Enter their email address and we’ll send an invitation to join BharatPath.` }
    : CREATE_COPY[segment];

  const prefillForm = segment === "employers" ? accountForms.data?.employer : accountForms.data?.college;
  const errors = useMemo(() => {
    const found: Record<string, string | undefined> = {};
    found.email = validateEmail(email, EMAIL_LABEL[segment]);
    if (mode === "create") {
      if (segment === "candidates") {
        if (name.trim()) found.name = validateName(name, "full name");
        if (name.trim().length > 120) found.name = "Use 120 characters or fewer.";
        if (Boolean(city.trim()) !== Boolean(stateCode)) {
          if (!city.trim()) found.city = "Enter the city, or clear the state.";
          else found.state = "Select the state, or clear the city.";
        }
        found.city ??= validateOptionalText(city, 100);
      } else {
        found.name = validateName(name, segment === "employers" ? "Legal name" : "Institution name");
      }
      if (segment === "institutions" && !institutionType) found.institutionType = "Select the institution type.";
      for (const section of prefillForm?.sections ?? []) {
        for (const field of section.fields) {
          if (PREFILL_EXCLUDED[segment].has(field.code)) continue;
          const message = validateField({ ...field, required: false } as never, draftAnswers[field.code]);
          if (message) found[`answer:${field.code}`] = message;
        }
      }
    }
    return found;
  }, [email, name, city, stateCode, institutionType, draftAnswers, prefillForm, mode, segment]);
  const shown = (key: string) =>
    serverErrors[key] ?? (submitted || touched.has(key) ? errors[key] : undefined);
  const touch = (key: string) => setTouched((current) => new Set(current).add(key));
  const edited = (key: string) =>
    setServerErrors((current) => {
      if (!(key in current)) return current;
      const rest = { ...current };
      delete rest[key];
      return rest;
    });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isLoading) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isLoading, onClose]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSubmitted(true);

    if (hasErrors(errors)) {
      showFormError("Fix the highlighted fields to continue.", { portal: "admin", container: form });
      return;
    }

    const prefillAnswers = cleanAnswers(
      draftAnswers,
      segment === "employers" ? accountForms.data?.employer : accountForms.data?.college,
    );

    try {
      if (mode === "invite") {
        await inviteAccount({
          email: email.trim(),
          kind: segment === "candidates" ? "CANDIDATE" : segment === "employers" ? "EMPLOYER" : "COLLEGE",
        }).unwrap();
        dispatch(showAdminFeedback("Invitation email sent."));
        onClose();
        return;
      }
      let invitation: "SENT" | "ALREADY_REGISTERED";
      if (segment === "candidates") {
        ({ invitation } = await provisionCandidate({
          email: email.trim(),
          ...(name.trim() ? { full_name: name.trim() } : {}),
          ...(city.trim() ? { city: city.trim(), state_code: stateCode } : {}),
        }).unwrap());
      } else if (segment === "employers") {
        ({ invitation } = await provisionEmployer({
          owner_email: email.trim(),
          legal_name: name.trim(),
          ...(employerType ? { employer_type: employerType } : {}),
          ...(industry ? { industry } : {}),
          ...(Object.keys(prefillAnswers).length ? { kyb_answers: prefillAnswers } : {}),
        }).unwrap());
      } else {
        ({ invitation } = await provisionCollege({
          admin_email: email.trim(),
          name: name.trim(),
          institution_type: institutionType,
          ...(Object.keys(prefillAnswers).length
            ? { onboarding_answers: prefillAnswers }
            : {}),
        }).unwrap());
      }
      dispatch(
        showAdminFeedback(
          invitation === "SENT"
            ? "Account created. A temporary password was emailed."
            : "Account created. They already have a sign-in, so no email was sent.",
        ),
      );
      onClose();
    } catch (error) {
      const message = getApiErrorMessage(
        error,
        mode === "invite"
          ? "The invitation could not be sent. Please try again."
          : "The account could not be created. Please try again.",
      );
      const code = getApiErrorCode(error);
      if (code === "identity_account_exists" || code === "identity_already_in_organisation" || code === "account_contact_in_use") {
        // The address is the problem, so say so on the address.
        setServerErrors((current) => ({ ...current, email: message }));
        showFormError(message, { portal: "admin", container: form, fieldId: "account-email" });
        return;
      }
      const issues = problemParam(error, "issues");
      if (Array.isArray(issues) && issues.length) {
        const byField: Record<string, string> = {};
        for (const issue of issues) {
          if (issue && typeof issue.field === "string") byField[`answer:${issue.field}`] = "This value was not accepted.";
        }
        setServerErrors((current) => ({ ...current, ...byField }));
        showFormError("Some profile answers were not accepted. Fix the highlighted fields.", { portal: "admin", container: form });
        return;
      }
      showFormError(message, { portal: "admin" });
    }
  }

  const employerTypes = reference.data?.employer_types ?? [];
  const industries = reference.data?.industries ?? [];

  return (
    <div data-scroll-lock-root className="fixed inset-0 z-[100]">
      <button
        type="button"
        aria-label="Close"
        disabled={isLoading}
        onClick={onClose}
        className="absolute inset-0 bg-[#172033]/30"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
        className="absolute right-0 top-0 flex h-full w-[480px] max-w-full flex-col bg-white shadow-[-20px_0_60px_-24px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[#e5e7eb] px-5 py-4">
          <div>
            <h2 className="text-[18px] font-bold text-[#172033]">{copy.title}</h2>
            <p className="mt-1 text-[12px] text-[#7b8494]">{copy.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#7b8494] hover:bg-[#f5f6f8]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            {mode === "create" ? <div className="rounded-xl border border-[#e3e7ed] bg-[#f8fafc] p-4">
              <h3 className="text-[13px] font-bold text-[#26334a]">Account details</h3>
              <p className="mt-1 text-[11px] leading-5 text-[#7b8494]">
                These details are saved before the invitation is sent.
              </p>
            </div> : null}

            {mode === "create" && segment !== "candidates" ? (
              <FormField id="account-name" label={segment === "employers" ? "Legal name" : "Institution name"} error={shown("name")}>
                <input
                  {...a11y("account-name", shown("name"))}
                  autoFocus
                  maxLength={255}
                  value={name}
                  onChange={(event) => { setName(event.target.value); edited("name"); }}
                  onBlur={() => touch("name")}
                  placeholder={segment === "employers" ? "Acme Private Limited" : "Institution name"}
                  className={inputClass(Boolean(shown("name")), INPUT_HEIGHT)}
                />
              </FormField>
            ) : null}

            <FormField id="account-email" label={EMAIL_LABEL[segment]} error={shown("email")}>
              <input
                {...a11y("account-email", shown("email"))}
                autoFocus={mode === "invite" || segment === "candidates"}
                type="email"
                autoComplete="off"
                maxLength={320}
                value={email}
                onChange={(event) => { setEmail(event.target.value); edited("email"); }}
                onBlur={() => touch("email")}
                placeholder="name@example.com"
                className={inputClass(Boolean(shown("email")), INPUT_HEIGHT)}
              />
            </FormField>

            {mode === "create" && segment === "candidates" ? (
              <>
                <FormField id="candidate-name" label="Full name (optional)" error={shown("name")}>
                  <input
                    {...a11y("candidate-name", shown("name"))}
                    value={name}
                    maxLength={120}
                    onChange={(event) => { setName(event.target.value); edited("name"); }}
                    onBlur={() => touch("name")}
                    placeholder="Candidate full name"
                    className={inputClass(Boolean(shown("name")), INPUT_HEIGHT)}
                  />
                </FormField>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField id="candidate-city" label="City (optional)" error={shown("city")}>
                    <input
                      {...a11y("candidate-city", shown("city"))}
                      value={city}
                      maxLength={100}
                      onChange={(event) => { setCity(event.target.value); edited("city"); }}
                      onBlur={() => touch("city")}
                      placeholder="Pune"
                      className={inputClass(Boolean(shown("city")), INPUT_HEIGHT)}
                    />
                  </FormField>
                  <div>
                    <span className="mb-1.5 block text-[12px] font-semibold text-[#344054]">State (optional)</span>
                    <AppSelect
                      value={stateCode}
                      onChange={(value) => { setStateCode(value); touch("state"); }}
                      options={INDIAN_STATES.map((state) => ({ value: state.code, label: state.name }))}
                      placeholder="Select state"
                      ariaLabel="State"
                      searchable
                      searchPlaceholder="Search states"
                      menuPlacement="top"
                      className={`[&>button]:h-10 [&>button]:rounded-lg [&>button]:px-3.5 [&>button]:text-[13px] [&>button>span]:text-[13px] [&>button>span]:font-medium [&>button>span]:text-[#303747] [&>button]:border-[#dfe2e8] [&>button]:focus:border-[#5b4fcf] [&>button]:focus:ring-2 [&>button]:focus:ring-[#5b4fcf]/20 ${shown("state") ? "[&>button]:!border-[#d92d20]" : ""}`}
                    />
                    <FieldError id="candidate-state-error" message={shown("state")} />
                  </div>
                </div>
              </>
            ) : null}

            {mode === "create" && segment === "employers" ? (
              <>
                <div>
                  <span className="mb-1.5 block text-[12px] font-semibold text-[#344054]">Employer type (optional)</span>
                  <SelectDropdown
                    value={employerType}
                    onChange={setEmployerType}
                    options={[{ value: "", label: "Not specified" }, ...employerTypes.map((item) => ({ value: item.code, label: item.label }))]}
                    ariaLabel="Employer type"
                    containerClassName="w-full"
                    className={DROPDOWN_CLASS}
                  />
                </div>
                <div>
                  <span className="mb-1.5 block text-[12px] font-semibold text-[#344054]">Industry (optional)</span>
                  <SelectDropdown
                    value={industry}
                    onChange={setIndustry}
                    options={[{ value: "", label: "Not specified" }, ...industries.map((item) => ({ value: item.code, label: item.label }))]}
                    ariaLabel="Industry"
                    containerClassName="w-full"
                    className={DROPDOWN_CLASS}
                  />
                </div>
              </>
            ) : null}

            {mode === "create" && segment === "institutions" ? (
              <div>
                <span className="mb-1.5 block text-[12px] font-semibold text-[#344054]">Institution type</span>
                <SelectDropdown
                  value={institutionType}
                  onChange={(value) => { setInstitutionType(value); touch("institutionType"); }}
                  options={INSTITUTION_TYPES}
                  placeholder="Select institution type"
                  ariaLabel="Institution type"
                  containerClassName="w-full"
                  className={shown("institutionType") ? "rounded-lg !border-[#d92d20]" : DROPDOWN_CLASS}
                />
                <FieldError id="institution-type-error" message={shown("institutionType")} />
              </div>
            ) : null}

            {mode === "create" && segment !== "candidates" ? (
              <AdminPrefillFields
                form={segment === "employers" ? accountForms.data?.employer : accountForms.data?.college}
                answers={draftAnswers}
                loading={accountForms.isLoading}
                error={accountForms.isError}
                menuPlacement={segment === "institutions" ? "top" : "bottom"}
                excludedCodes={PREFILL_EXCLUDED[segment]}
                errorFor={(code) => shown(`answer:${code}`)}
                onChange={(code, value) => {
                  setDraftAnswers((current) => ({ ...current, [code]: value }));
                  edited(`answer:${code}`);
                }}
                onBlur={(code) => touch(`answer:${code}`)}
              />
            ) : null}

          </div>

          <footer className="flex justify-end gap-2 border-t border-[#e5e7eb] p-4">
            <Button type="button" variant="secondary" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" variant="dark" isLoading={isLoading} loadingText={mode === "invite" ? "Sending…" : "Creating…"}>
              {copy.title}
            </Button>
          </footer>
        </form>
      </aside>
    </div>
  );
}

function AdminPrefillFields({
  form,
  answers,
  loading,
  error,
  menuPlacement,
  excludedCodes,
  errorFor,
  onChange,
  onBlur,
}: {
  form?: AdminAccountForm;
  answers: Record<string, unknown>;
  loading: boolean;
  error: boolean;
  menuPlacement: "top" | "bottom";
  excludedCodes: ReadonlySet<string>;
  errorFor: (code: string) => string | undefined;
  onChange: (code: string, value: unknown) => void;
  onBlur: (code: string) => void;
}) {
  if (loading) {
    return <p className="text-[12px] text-[#7b8494]">Loading profile fields…</p>;
  }
  if (error || !form) {
    return (
      <p role="alert" className="rounded-lg border border-[#f1c0c0] bg-[#fff5f5] px-3 py-2 text-[12px] text-[#9f2d2d]">
        Profile fields could not be loaded. Close the drawer and try again.
      </p>
    );
  }

  return (
    <div className="space-y-5 border-t border-[#e5e7eb] pt-5">
      <div>
        <h3 className="text-[14px] font-bold text-[#26334a]">Prefill their profile</h3>
        <p className="mt-1 text-[11px] leading-5 text-[#7b8494]">
          Optional. The user will find these answers filled in as a draft after signing in. They must accept declarations, upload documents, and submit it themselves.
        </p>
      </div>
      {form.sections.map((section) => {
        const fields = section.fields.filter((field) => !excludedCodes.has(field.code));
        if (!fields.length) return null;
        return (
          <section key={section.code} className="space-y-4 rounded-xl border border-[#e3e7ed] p-4">
            <div>
              <h4 className="text-[13px] font-bold text-[#344054]">{section.title}</h4>
              {section.help_text ? <p className="mt-1 text-[11px] text-[#7b8494]">{section.help_text}</p> : null}
            </div>
            {fields.map((field) => (
              <div key={field.code} onBlur={() => onBlur(field.code)}>
              <KybFieldInput
                field={{ ...field, required: false }}
                error={errorFor(field.code)}
                value={answers[field.code]}
                options={field.options_source ? (form.options[field.options_source] ?? []) : []}
                menuPlacement={menuPlacement}
                onChange={(value) => onChange(field.code, value)}
              />
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function cleanAnswers(
  answers: Record<string, unknown>,
  form?: AdminAccountForm,
): Record<string, unknown> {
  if (!form) return {};
  const fields = new Map<string, AdminAccountFormField>(
    form.sections.flatMap((section) => section.fields).map((field) => [field.code, field]),
  );
  return Object.fromEntries(
    Object.entries(answers).flatMap(([code, value]) => {
      const field = fields.get(code);
      if (!field) return [];
      const normalized = wireValue(field, value);
      return normalized === null || normalized === undefined || normalized === ""
        ? []
        : [[code, normalized]];
    }),
  );
}
