import { Suspense } from "react";

import { CollegeSettings } from "@/features/college/settings/components/college-settings";

export default function CollegeSettingsPage() {
  // `useSearchParams` (the `?tab=` link) needs a Suspense boundary.
  return (
    <Suspense>
      <CollegeSettings />
    </Suspense>
  );
}
