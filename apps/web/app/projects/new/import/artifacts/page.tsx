"use client";

import { Suspense } from "react";

import { BrownfieldImportPage } from "@/brownfield/BrownfieldImportPage";

/**
 * Tier-A entry point (BF-3.3, F-15) — `/projects/new/import/artifacts`.
 *
 * Replaces the BF-3.1 placeholder that redirected back to `/projects/new/import`
 * because the screen did not exist yet. Mounting this route is what makes the
 * `artifacts` import sub-option `status: "available"` in
 * `features/landing/domain/creation-path.ts` truthful; the two changes ship in
 * the same packet by design, and `creation-path.test.ts` fails in BOTH
 * directions if only one of them lands.
 *
 * `Suspense` is required, not decorative: `BrownfieldImportPage` reads the
 * carried project name with `useSearchParams`, which opts the subtree into
 * client-side bailout during prerender. The sibling `import/scan` route is
 * wrapped for the same reason.
 */
export default function ImportArtifactsPage() {
  return (
    <Suspense>
      <BrownfieldImportPage />
    </Suspense>
  );
}
