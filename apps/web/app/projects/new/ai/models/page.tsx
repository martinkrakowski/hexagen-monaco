import { Suspense } from "react";
import { ModelSelectionPageClient } from "./ModelSelectionPageClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense>
      <ModelSelectionPageClient />
    </Suspense>
  );
}
