import type { ReactNode } from "react";

export type StructuredStatus = "READY" | "FAILED" | "UNAVAILABLE";
export interface StructuredResume {
  full_name: string;
  headline: string;
  location: string;
  summary: string;
  contacts: {
    email: string; phone: string; linkedin: string; github: string; behance: string;
    website: string; instagram: string; tiktok: string; pinterest: string;
    x_twitter: string; medium: string; dev_to: string; stack_overflow: string;
    others: Array<{ label: string; url: string }>;
  };
  experience: Array<{ job_title: string; company: string; location: string; employment_type: string;
    start_date: string; end_date: string; is_current: boolean; description: string;
    highlights: string[]; skills_used: string[] }>;
  education: Array<{ qualification: string; field_of_study: string; institution: string;
    location: string; start_date: string; end_date: string; grade: string; description: string }>;
  skills: string[];
  projects: Array<{ name: string; role: string; description: string; technologies: string[];
    url: string; start_date: string; end_date: string }>;
  certifications: Array<{ name: string; issuer: string; issue_date: string; expiry_date: string;
    credential_id: string; url: string }>;
  languages: Array<{ name: string; proficiency: string }>;
  achievements: string[];
  interests: string[];
  other_sections: Array<{ heading: string; items: string[] }>;
}

const labels: Record<string, string> = {
  full_name: "Full name", url: "URL", others: "Other links", x_twitter: "X / Twitter", dev_to: "DEV Community",
  stack_overflow: "Stack Overflow", github: "GitHub", linkedin: "LinkedIn",
  tiktok: "TikTok", skills_used: "Skills used", field_of_study: "Field of study",
  is_current: "Current role", credential_id: "Credential ID",
};
export const resumeLabel = (key: string) => labels[key] ?? key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const isVisible = (value: unknown): boolean =>
  value !== null && value !== undefined && value !== "" && value !== false &&
  (!Array.isArray(value) || value.length > 0);

function SkillBadges({ skills }: { skills: string[] }) {
  return <ul className="flex flex-wrap gap-2" aria-label="Resume skills">{skills.map((skill, index) => <li key={`${skill}-${index}`} className="max-w-full break-words rounded-full border border-[#d5dfee] bg-[#eef3fb] px-3 py-1.5 text-[12px] font-medium text-[#315c9f]">{skill}</li>)}</ul>;
}

function Value({ value, student = false }: { value: unknown; student?: boolean }): ReactNode {
  if (!isVisible(value)) return null;
  if (student && Array.isArray(value) && value.every((item) => item !== null && typeof item === "object")) return <div className="space-y-3">{value.map((item, index) => <div key={index} className="rounded-[16px] border border-[#E7E0D4] bg-[#F7F4EC] p-4"><Value value={item} student /></div>)}</div>;
  if (Array.isArray(value)) return <ul className={`space-y-2 pl-4 text-[13px] leading-5 ${student ? "text-[#3A4761]" : "text-[#344054]"}`}>{value.map((item, index) => <li key={index} className="list-disc break-words">{typeof item === "string" ? item : <Value value={item} student={student} />}</li>)}</ul>;
  if (value !== null && typeof value === "object") return <dl className={`grid gap-x-6 gap-y-3 sm:grid-cols-2 ${student ? "lg:grid-cols-1 xl:grid-cols-2" : ""}`}>{Object.entries(value).filter(([, item]) => isVisible(item)).map(([key, item]) => <div key={key} className="min-w-0"><dt className={`text-[11px] font-medium ${student ? "text-[#7B8495]" : "text-[#7b8494]"}`}>{resumeLabel(key)}</dt><dd className="mt-1 break-words">{key === "skills" && Array.isArray(item) && item.every((skill) => typeof skill === "string") ? <SkillBadges skills={item} /> : <Value value={item} student={student} />}</dd></div>)}</dl>;
  return <span className={`whitespace-pre-wrap break-words leading-5 ${student ? "text-[14px] font-medium text-[#0A1931]" : "text-[13px] text-[#344054]"}`}>{value === true ? "Yes" : String(value)}</span>;
}

const sections: Array<{ key: keyof StructuredResume; title: string }> = [
  { key: "contacts", title: "Contact and links" }, { key: "experience", title: "Experience" },
  { key: "education", title: "Education" }, { key: "skills", title: "Skills" },
  { key: "projects", title: "Projects" }, { key: "certifications", title: "Certifications" },
  { key: "languages", title: "Languages" }, { key: "achievements", title: "Achievements" },
  { key: "interests", title: "Interests" }, { key: "other_sections", title: "Other sections" },
];

export function StructuredResumeView({ resume }: { resume: StructuredResume }) {
  return <div className="space-y-4">
    <section className="rounded-xl border border-[#e7e9ee] bg-white p-4">
      <h3 className="text-[17px] font-bold text-[#172033]">{resume.full_name || "Name not provided"}</h3>
      {[resume.headline, resume.location, resume.summary].filter(Boolean).map((line, index) => <p key={index} className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-5 text-[#344054]">{line}</p>)}
    </section>
    {sections.filter(({ key }) => isVisible(resume[key]) && (key !== "contacts" || Object.values(resume.contacts).some(isVisible))).map(({ key, title }) => <section key={key} className="rounded-xl border border-[#e7e9ee] bg-white p-4">
      <h3 className="mb-3 text-[13px] font-bold text-[#172033]">{title}</h3>
      {key === "skills" ? <SkillBadges skills={resume.skills} /> : <Value value={resume[key]} />}
    </section>)}
  </div>;
}

export function StructuredResumeUnavailable({ status }: { status?: StructuredStatus }) {
  return <div className="rounded-xl border border-dashed border-[#dfe4ec] bg-white px-4 py-5">
    <p className="text-[13px] font-semibold text-[#172033]">Structured resume details unavailable</p>
    <p className="mt-1 text-[12px] leading-5 text-[#687182]">
      {status === "FAILED"
        ? "The details for this resume could not be organised into sections."
        : "This resume version does not have structured details to display."}
    </p>
  </div>;
}

export function StructuredResumeSectionView({ resume, section }: { resume: StructuredResume; section: keyof StructuredResume | "basics" }) {
  if (section === "basics") return [resume.full_name, resume.headline, resume.location, resume.summary].some(Boolean) ? <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">{(["full_name", "headline", "location", "summary"] as const).filter((key) => isVisible(resume[key])).map((key) => <div key={key} className={key === "summary" ? "sm:col-span-2 lg:col-span-1 xl:col-span-2" : ""}><dt className="text-[11px] font-medium text-[#7B8495]">{resumeLabel(key)}</dt><dd className="mt-1"><Value value={resume[key]} student /></dd></div>)}</dl> : <p className="text-[13px] text-[#5F6B80]">Nothing added yet.</p>;
  if (section === "contacts" && !Object.values(resume.contacts).some(isVisible)) return <p className="text-[13px] text-[#5F6B80]">Nothing added yet.</p>;
  if (!isVisible(resume[section])) return <p className="text-[13px] text-[#5F6B80]">Nothing added yet.</p>;
  if (section === "skills" || section === "interests") return <div className="flex flex-wrap gap-2">{resume[section].map((item, index) => <span key={`${item}-${index}`} className="rounded-full bg-[#F7EFD6] px-3 py-2 text-[13px] font-medium text-[#0A1931]">{item}</span>)}</div>;
  return <Value value={resume[section]} student />;
}
