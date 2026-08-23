"use client";

import type { ReactNode } from "react";
import { ProjectsShellWithFreeTier } from "@/ProjectsShellWithFreeTier";
import { BrownfieldStepIndicator } from "./BrownfieldStepIndicator";

/**
 * The chrome every brownfield screen shares: the projects shell, the scroll
 * container, the centred content column and the step indicator.
 *
 * Extracted so S3–S6 do not each re-type the same four nested divs that
 * `BrownfieldImportPage` already had. It is deliberately NOT a router or a
 * state boundary — it takes finished nodes and renders them, so a screen
 * container remains testable without a router mock.
 *
 * ## Why `measure` is an enum and not a className
 *
 * Tailwind's JIT scans source text for complete class names, so a width passed
 * as an arbitrary string could be a class that was never generated — it would
 * look right in review and be missing in the build. The two measures the plan
 * names (`max-w-3xl` for S1, `max-w-4xl` for the dense ratification screens)
 * are therefore spelled out as literals here.
 */
export type BrownfieldScreenMeasure = "narrow" | "wide";

const MEASURE_CLASS: Record<BrownfieldScreenMeasure, string> = {
  narrow: "max-w-3xl mx-auto px-4 sm:px-6 w-full",
  wide: "max-w-4xl mx-auto px-4 sm:px-6 w-full",
};

export interface BrownfieldScreenFrameProps {
  /** Shell title. Every screen in the flow uses the same one. */
  title?: string;
  measure?: BrownfieldScreenMeasure;
  /** Back / primary actions. Lives in the shell footer, never in the column. */
  footer?: ReactNode;
  children: ReactNode;
}

export function BrownfieldScreenFrame({
  title = "Import an existing codebase",
  measure = "narrow",
  footer,
  children,
}: BrownfieldScreenFrameProps) {
  return (
    <ProjectsShellWithFreeTier title={title} footer={footer}>
      <div className="h-full overflow-y-auto">
        <div className="flex items-center justify-center min-h-full py-6 sm:py-12">
          <div className={MEASURE_CLASS[measure]}>
            <BrownfieldStepIndicator />
            {children}
          </div>
        </div>
      </div>
    </ProjectsShellWithFreeTier>
  );
}

/**
 * The slice's one inline advisory surface.
 *
 * `role="alert"` when it reports something that blocks the user, `role="status"`
 * when it is an FYI — the split `GithubScanPage` already makes for its form
 * notice, kept here so three screens do not each invent their own.
 */
export interface BrownfieldNoticeProps {
  children: ReactNode;
  /** True when this is a response to a failed or blocked action. */
  assertive?: boolean;
}

export function BrownfieldNotice({
  children,
  assertive = false,
}: BrownfieldNoticeProps) {
  return (
    <p
      role={assertive ? "alert" : "status"}
      className={
        assertive
          ? "mb-6 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          : "mb-6 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
      }
    >
      {children}
    </p>
  );
}
