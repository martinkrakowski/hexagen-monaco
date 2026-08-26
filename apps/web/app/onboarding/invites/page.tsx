import { Suspense } from "react";
import { InvitesClient } from "./InvitesClient";

// Suspense is required because InvitesClient reads useSearchParams (`?org=`).
export default function OnboardingInvitesPage() {
  return (
    <Suspense fallback={null}>
      <InvitesClient />
    </Suspense>
  );
}
