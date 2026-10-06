import type { StructuredResume } from "./structured-resume";

/** Full text for the backend's existing text edit endpoint. */
export function structuredResumeToText(resume: StructuredResume): string {
  const blocks: string[] = [];
  const add = (heading: string, lines: string[]) => {
    const content = lines.map((line) => line.trim()).filter(Boolean);
    if (content.length) blocks.push(`${heading}\n${content.join("\n")}`);
  };
  const c = resume.contacts;
  const links = (["linkedin", "github", "behance", "website", "instagram", "tiktok", "pinterest", "x_twitter", "medium", "dev_to", "stack_overflow"] as const)
    .filter((key) => c[key]).map((key) => `${key.replaceAll("_", " ")}: ${c[key]}`);
  add("Profile", [resume.full_name, resume.headline, resume.location, c.email, c.phone,
    ...links, ...c.others.filter((link) => link.label || link.url).map((link) => `${link.label}: ${link.url}`)]);
  add("Summary", [resume.summary]);
  add("Experience", resume.experience.flatMap((role) => [
    [role.job_title, role.company, role.location, role.employment_type,
      [role.start_date, role.is_current ? "Present" : role.end_date].filter(Boolean).join(" to ")].filter(Boolean).join(" | "),
    role.description, ...role.highlights.map((item) => `- ${item}`),
    role.skills_used.length ? `Skills used: ${role.skills_used.join(", ")}` : "",
  ]));
  add("Education", resume.education.map((item) => [item.qualification, item.field_of_study,
    item.institution, item.location, [item.start_date, item.end_date].filter(Boolean).join(" to "),
    item.grade, item.description].filter(Boolean).join(" | ")));
  add("Skills", resume.skills);
  add("Projects", resume.projects.flatMap((project) => [
    [project.name, project.role, project.url,
      [project.start_date, project.end_date].filter(Boolean).join(" to ")].filter(Boolean).join(" | "),
    project.description, project.technologies.length ? `Technologies: ${project.technologies.join(", ")}` : "",
  ]));
  add("Certifications", resume.certifications.map((item) => [item.name, item.issuer,
    item.issue_date, item.expiry_date, item.credential_id, item.url].filter(Boolean).join(" | ")));
  add("Languages", resume.languages.map((item) => [item.name, item.proficiency].filter(Boolean).join(" | ")));
  add("Achievements", resume.achievements);
  add("Interests", resume.interests);
  resume.other_sections.forEach((section) => add(section.heading || "Other", section.items));
  return blocks.join("\n\n");
}
