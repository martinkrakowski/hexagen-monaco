import { Suspense } from "react";
import { TeamClient } from "./TeamClient";

// Suspense is required because TeamClient reads useSearchParams (`?org=`).
export default function OnboardingTeamPage() {
  return (
    <Suspense fallback={null}>
      <TeamClient />
    </Suspense>
  );
}
