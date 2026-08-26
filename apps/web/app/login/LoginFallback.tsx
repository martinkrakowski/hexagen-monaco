"use client";

import { Spinner } from "@hexagen/ui";

/**
 * The Suspense fallback lives in its own CLIENT file because page.tsx is a
 * server component: importing the @hexagen/ui barrel there drags hook-using
 * modules (useRovingTabIndex, FileDropZone, …) into the RSC build, which
 * fails `next build` — vitest never sees this, only the production build
 * does (broke main at f6ce5ef2).
 */
export function LoginFallback() {
  return (
    <div className="h-full flex items-center justify-center">
      <Spinner />
    </div>
  );
}
