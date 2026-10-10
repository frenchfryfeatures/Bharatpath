import { choiceLabel } from "@/lib/format/labels";
import type { CandidateOnboarding } from "@/store/api/admin-api";
import type { CareerDetails, CareerField } from "@/features/student/profile/career-api";

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#8992a1]">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-[13px] font-semibold text-[#172033]">
        {value === null || value === undefined || value === "" ? "Not provided" : value}
      </dd>
    </div>
  );
}

function displayValue(field: CareerField, details: CareerDetails): string | number | null {
  const value = details[field.key];
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) return value.join(", ") || null;
  if (field.key === "experience_years" || field.key === "experience_months") {
    return details.work_status ? value : null;
  }
  if (field.key === "annual_salary" || field.key === "preferred_salary") {
    return typeof value === "number"
      ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value)
      : value;
  }
  if (field.type === "month" && typeof value === "string" && /^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  }
  return field.options.find((option) => option.value === value)?.label ?? (field.options.length && typeof value === "string" ? choiceLabel(value) : value);
}

export function CandidateOnboardingDetails({ onboarding }: { onboarding: CandidateOnboarding }) {
  const career = onboarding.career;
  const fields = onboarding.career_fields ?? [];
  const basicFields = fields.filter((field) => field.section === "basic" && field.key !== "phone");
  const updated = career?.updated_at ? new Date(career.updated_at) : null;
  const declaredPhone = career?.details.phone;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${career?.completed ? "bg-[#e7f3ec] text-[#24734c]" : "bg-[#eef3fb] text-[#315c9f]"}`}>
          {career ? (career.completed ? "Profile completed" : "Profile in progress") : "Career details not added"}
        </span>
        {updated && !Number.isNaN(updated.getTime()) && (
          <span className="text-[11px] text-[#7b8494]">Updated {updated.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
        )}
        {career?.resume_filename && <span className="break-all text-[11px] text-[#7b8494]">Resume: {career.resume_filename}</span>}
      </div>

      <section aria-label="Basic details">
        <h3 className="mb-3 text-[12px] font-bold text-[#172033]">Basic details</h3>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" value={onboarding.full_name} />
          <Field label="Email ID" value={onboarding.email} />
          <Field label="Mobile number" value={typeof declaredPhone === "string" && declaredPhone ? declaredPhone : onboarding.phone} />
          {basicFields.map((field) => <Field key={field.key} label={field.label} value={career ? displayValue(field, career.details) : null} />)}
          <Field label="Location" value={[career?.details.current_city || onboarding.city, onboarding.state_code].filter(Boolean).join(", ")} />
          <Field label="Language" value={onboarding.locale} />
        </dl>
      </section>

      {!fields.length && (
        <p className="rounded-lg border border-dashed border-[#e1e5eb] bg-[#fbfcfd] p-4 text-[12px] text-[#7b8494]">Career details are unavailable from this backend.</p>
      )}
      {([
        ["employment", "Employment details"],
        ["education", "Education details"],
        ["preferences", "Headline and preferences"],
      ] as const).map(([section, title]) => {
        const sectionFields = fields.filter((field) => field.section === section);
        if (!sectionFields.length) return null;
        return (
          <section key={section} aria-label={title} className="border-t border-[#edf0f3] pt-4">
            <h3 className="mb-3 text-[12px] font-bold text-[#172033]">{title}</h3>
            <dl className="grid gap-4 sm:grid-cols-2">
              {sectionFields.map((field) => <Field key={field.key} label={field.label} value={career ? displayValue(field, career.details) : null} />)}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
