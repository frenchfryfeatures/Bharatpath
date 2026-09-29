import { RosterPreview } from "@/features/college/students";

export interface RosterPreviewPageProps {
  params: Promise<{
    importId: string;
  }>;
}

export default async function RosterPreviewPage({
  params,
}: Readonly<RosterPreviewPageProps>) {
  const { importId } = await params;
  return <RosterPreview importId={importId} />;
}
