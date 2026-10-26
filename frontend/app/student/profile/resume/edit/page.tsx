import { ResumeBuilderEditor } from "@/features/student/profile/resume-builder-editor";
import type { BuilderTemplateKey } from "@/store/student";

const templateKeys: BuilderTemplateKey[] = ["classic", "modern", "sidebar", "minimal"];

export default async function StudentResumeBuilderEditPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string; section?: string; from?: string }>;
}) {
  const { template, section, from } = await searchParams;
  const templateKey = templateKeys.find((key) => key === template);
  return <ResumeBuilderEditor templateKey={templateKey} section={section} returnTo={from === "resume-details" ? "resume-details" : "profile"} />;
}
