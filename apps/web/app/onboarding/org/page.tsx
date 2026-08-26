import { Suspense } from "react";
import { OrgClient } from "./OrgClient";

// Suspense is required because OrgClient reads useSearchParams (`?org=` for
// replay safety) — see the load-bearing note in app/login/page.tsx.
export default function OnboardingOrgPage() {
  return (
    <Suspense fallback={null}>
      <OrgClient />
    </Suspense>
  );
}
