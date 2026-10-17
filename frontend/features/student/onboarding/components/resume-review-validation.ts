import type { StructuredResume } from "@/components/resume/structured-resume";

export type ReviewPath = Array<string | number>;
export interface ReviewIssue { path: ReviewPath; message: string }

const datePattern = /^\d{4}(?:-(0[1-9]|1[0-2]))?$/;
const required = (value: string, path: ReviewPath, label: string, issues: ReviewIssue[]) => {
  if (!value.trim()) issues.push({ path, message: `Enter ${label}.` });
};
const date = (value: string, path: ReviewPath, label: string, issues: ReviewIssue[], mandatory = true) => {
  if (!value.trim()) {
    if (mandatory) issues.push({ path, message: `Enter ${label}.` });
  } else if (!datePattern.test(value.trim())) {
    issues.push({ path, message: `Use YYYY or YYYY-MM for ${label}.` });
  }
};
const dateOrder = (start: string, end: string, path: ReviewPath, issues: ReviewIssue[]) => {
  if (!datePattern.test(start) || !datePattern.test(end)) return;
  const startYear = Number(start.slice(0, 4));
  const endYear = Number(end.slice(0, 4));
  if (endYear < startYear || (endYear === startYear && start.length === 7 && end.length === 7 && end < start)) {
    issues.push({ path, message: "End date must follow the start date." });
  }
};
const nonblankList = (items: string[], path: ReviewPath, issues: ReviewIssue[]) => {
  items.forEach((item, index) => required(item, [...path, index], "a value or remove this entry", issues));
};

export function validateReviewedResume(resume: StructuredResume): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  required(resume.full_name, ["full_name"], "your full name", issues);
  if (resume.contacts.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resume.contacts.email.trim())) {
    issues.push({ path: ["contacts", "email"], message: "Enter a valid email address." });
  }
  resume.contacts.others.forEach((link, index) => {
    required(link.label, ["contacts", "others", index, "label"], "a link label", issues);
    required(link.url, ["contacts", "others", index, "url"], "a link URL", issues);
  });
  resume.experience.forEach((item, index) => {
    const path = ["experience", index];
    required(item.job_title, [...path, "job_title"], "a job title", issues);
    required(item.company, [...path, "company"], "a company", issues);
    date(item.start_date, [...path, "start_date"], "a start date", issues);
    if (!item.is_current) {
      date(item.end_date, [...path, "end_date"], "an end date", issues);
      dateOrder(item.start_date, item.end_date, [...path, "end_date"], issues);
    }
    nonblankList(item.highlights, [...path, "highlights"], issues);
    nonblankList(item.skills_used, [...path, "skills_used"], issues);
  });
  resume.education.forEach((item, index) => {
    const path = ["education", index];
    required(item.qualification, [...path, "qualification"], "a qualification", issues);
    required(item.institution, [...path, "institution"], "an institution", issues);
    date(item.start_date, [...path, "start_date"], "a start date", issues);
    date(item.end_date, [...path, "end_date"], "an end date", issues);
    dateOrder(item.start_date, item.end_date, [...path, "end_date"], issues);
  });
  nonblankList(resume.skills, ["skills"], issues);
  resume.projects.forEach((item, index) => {
    const path = ["projects", index];
    required(item.name, [...path, "name"], "a project name", issues);
    required(item.description, [...path, "description"], "a project description", issues);
    date(item.start_date, [...path, "start_date"], "a start date", issues, false);
    date(item.end_date, [...path, "end_date"], "an end date", issues, false);
    dateOrder(item.start_date, item.end_date, [...path, "end_date"], issues);
    nonblankList(item.technologies, [...path, "technologies"], issues);
  });
  resume.certifications.forEach((item, index) => {
    const path = ["certifications", index];
    required(item.name, [...path, "name"], "a certification name", issues);
    required(item.issuer, [...path, "issuer"], "an issuer", issues);
    date(item.issue_date, [...path, "issue_date"], "an issue date", issues);
    date(item.expiry_date, [...path, "expiry_date"], "an expiry date", issues, false);
    dateOrder(item.issue_date, item.expiry_date, [...path, "expiry_date"], issues);
  });
  resume.languages.forEach((item, index) => {
    required(item.name, ["languages", index, "name"], "a language", issues);
    required(item.proficiency, ["languages", index, "proficiency"], "a proficiency", issues);
  });
  nonblankList(resume.achievements, ["achievements"], issues);
  nonblankList(resume.interests, ["interests"], issues);
  resume.other_sections.forEach((item, index) => {
    required(item.heading, ["other_sections", index, "heading"], "a section heading", issues);
    if (!item.items.length) issues.push({ path: ["other_sections", index, "items"], message: "Add at least one item." });
    nonblankList(item.items, ["other_sections", index, "items"], issues);
  });
  return issues;
}
