"use client";

import { Suspense } from "react";

import { GithubScanPage } from "@/brownfield/ScanProgress/GithubScanPage";

/**
 * Tier-B entry point (BF-5.3, F-16) — `/projects/new/import/github`.
 *
 * Replaces the placeholder that redirected back to `/projects/new/import`
 * because the screen did not exist yet. Mounting this route is what makes the
 * `github` import sub-option `status: "available"` in
 * `features/landing/domain/creation-path.ts` truthful; the two changes ship in
 * the same packet by design, and `creation-path.test.ts` fails in BOTH
 * directions if only one of them lands.
 *
 * Note what "mounted" does and does not promise. The SCREEN is always here; the
 * ENDPOINT behind it is behind `BROWNFIELD_GITHUB_SCAN`, which defaults off, so
 * in most deployments `/api/projects/scan/github` answers 404. The screen probes
 * for that on mount and says so plainly rather than offering a form that can
 * only fail — see `useGithubScanAvailability`, the probe this screen and
 * the brownfield tier picker both read.
 *
 * `Suspense` is required, not decorative: `GithubScanPage` reads the carried
 * project name with `useSearchParams`, which opts the subtree into client-side
 * bailout during prerender. The sibling `import/artifacts` and `import/scan`
 * routes are wrapped for the same reason.
 */
export default function ImportGitHubPage() {
  return (
    <Suspense>
      <GithubScanPage />
    </Suspense>
  );
}
