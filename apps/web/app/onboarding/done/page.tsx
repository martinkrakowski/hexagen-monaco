import { Suspense } from "react";
import { DoneClient } from "./DoneClient";

// Suspense is required because DoneClient reads useSearchParams (`?org=`).
export default function OnboardingDonePage() {
  return (
    <Suspense fallback={null}>
      <DoneClient />
    </Suspense>
  );
}
