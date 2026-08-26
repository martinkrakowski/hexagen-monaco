import { Suspense } from "react";
import { LoginClient } from "./LoginClient";

// Suspense is required because LoginClient reads useSearchParams — see the
// load-bearing note in app/projects/new/import/artifacts/page.tsx.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginClient />
    </Suspense>
  );
}
