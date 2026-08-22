"use client";

import { Braces, FolderSearch, Github } from "lucide-react";
import { ChoiceCardGroup } from "@/primitives/ChoiceCardGroup";
import type { ChoiceCardOption } from "@/primitives/ChoiceCardGroup";
import { MAX_SCAN_ZIP_BYTES } from "@/lib/project-scan/limits";
import type { BrownfieldTier } from "../BrownfieldFlow/types";

/**
 * S1 — "How should we read your codebase?" (F-15).
 *
 * PRESENTATIONAL ONLY. It owns no selection state, performs no navigation and
 * knows nothing about the upload route; `BrownfieldImportPage` is the boundary
 * component that decides what a pick means. That split is what lets the whole
 * screen be tested without a router, a fetch stub or the free-tier context.
 *
 * COMPOSED, NOT REBUILT: the three cards are `ChoiceCardGroup` (BF-2.2), which
 * already owns the `role="radiogroup"` semantics, the roving tabindex, the
 * arrow-key walk that steps over unavailable cards, and the
 * `disabled`/`unavailableReason` pair. Nothing about a privacy tier justified a
 * second radio-card implementation.
 *
 * WHY `badge` CARRIES THE FILE LIST: the plan is explicit that the "leaves your
 * machine" strip is an honesty affordance and "must not be collapsed into the
 * description". `ChoiceCardGroup` exposes exactly one badge slot, so the strip
 * takes it and the word "Recommended" moves into the card's own label — the
 * recommendation is a preference we can restate anywhere, the disclosure of
 * what leaves the user's machine is not.
 */

/** MiB, for the copy. `MAX_SCAN_ZIP_BYTES` is the Tier-C route's own constant. */
const TIER_C_MAX_MIB = Math.floor(MAX_SCAN_ZIP_BYTES / (1024 * 1024));

/**
 * The five labelled artifacts `hexagen scan --handoff` writes. Spelled out
 * rather than counted: the plan's R-29 adjudication dropped the "6 files"
 * claim precisely because a user does not need the count, they need to know
 * WHICH things travel.
 */
const HANDOFF_STRIP = "manifest · layout · baseline · report · ledger";

export const BROWNFIELD_TIER_OPTIONS: readonly ChoiceCardOption<BrownfieldTier>[] =
  [
    {
      value: "artifacts",
      label: "Artifacts only — recommended",
      description:
        "You run `npx hexagen scan --handoff` on your own machine and upload the handoff zip. No source code is uploaded; file paths, package names and rule findings are.",
      badge: HANDOFF_STRIP,
      Icon: Braces,
    },
    {
      value: "clone",
      label: "Public repo URL",
      description:
        "We shallow-clone the repository, scan it in a temporary directory, and delete it. Nothing is retained but the scan artifacts.",
      warning: "Not for client engagements.",
      // Tier B is BF-5.2/BF-5.3 and is gated on a decision (a hexagen CLI in
      // the production image). Rendering it disabled with the reason is the
      // honest state: the option exists in the product's design, it is simply
      // not reachable yet. Hiding it would make the tier list read as if only
      // two tiers were ever planned.
      disabled: true,
      unavailableReason:
        "Server-side cloning is not available yet. Run the scan locally and upload the artifacts, or upload a zip of the repository.",
      Icon: Github,
    },
    {
      value: "zip",
      label: "Upload a zip",
      description: `Upload a zip of the repository. Same retention as above — scanned in a temporary directory, then deleted. Max ${TIER_C_MAX_MIB} MB.`,
      Icon: FolderSearch,
    },
  ] as const;

export interface TierPickerViewProps {
  /** The tier the user has picked, or null before the first pick. */
  tier: BrownfieldTier | null;
  onSelectTier: (tier: BrownfieldTier) => void;
  /** Name carried in from the shared project-name step, shown for orientation. */
  projectName: string;
}

export function TierPickerView({
  tier,
  onSelectTier,
  projectName,
}: TierPickerViewProps) {
  return (
    <div className="space-y-8">
      <div className="text-center animate-fade-in-up delay-100">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
          How should we read your codebase?
        </h1>
        <p className="text-muted-foreground max-w-md mx-auto leading-relaxed">
          Pick what leaves your machine. You ratify everything after.
        </p>
        <p className="text-sm text-muted-foreground mt-3">
          Project:{" "}
          <span className="font-medium text-foreground">{projectName}</span>
        </p>
      </div>

      <div className="animate-fade-in-up delay-200">
        <ChoiceCardGroup<BrownfieldTier>
          label="How your codebase is read"
          options={BROWNFIELD_TIER_OPTIONS}
          value={tier}
          onSelect={onSelectTier}
        />
      </div>
    </div>
  );
}
