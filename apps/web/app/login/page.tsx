import { Suspense } from "react";
import { LoginClient } from "./LoginClient";
import { LoginFallback } from "./LoginFallback";

// Suspense is required because LoginClient reads useSearchParams — see the
// load-bearing note in app/projects/new/import/artifacts/page.tsx.
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginClient />
    </Suspense>
  );
}
