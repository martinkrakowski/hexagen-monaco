"use client";

import { Braces, FolderSearch, Github } from "lucide-react";
import { ChoiceCardGroup } from "@/primitives/ChoiceCardGroup";
import type { ChoiceCardOption } from "@/primitives/ChoiceCardGroup";
import { MAX_SCAN_ZIP_BYTES } from "@/lib/project-scan/limits";
import type { BrownfieldTier } from "../BrownfieldFlow/types";
import { describeUnavailable } from "../ScanProgress/unavailable-copy";
import type { GithubScanAvailability } from "../ScanProgress/useGithubScanAvailability";

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

/** The retention sentence for Tier B. True whenever the tier can run at all. */
const CLONE_DESCRIPTION =
  "We shallow-clone the repository, scan it in a temporary directory, and delete it. Nothing is retained but the scan artifacts.";

/**
 * Tier B's card, told the truth in each of the four states the probe can be in.
 *
 * BF-5.3 SHIPPED this tier — `/projects/new/import/github` is mounted and the
 * landing page lists it as available — so "not available yet" is simply false.
 * But `BROWNFIELD_GITHUB_SCAN` is off by default and the route then 404s, so
 * "available" is equally false on a default deployment. The card therefore says
 * what the deployment actually answered, and nothing more:
 *
 * - `checking` — the probe is in flight. Unpickable, because a card that
 *   accepts a pick and then reveals there was nothing behind it is worse than a
 *   card that asks for a moment. This is the same call the scan screen makes
 *   with its submit button.
 * - `available` — the endpoint answered. Pickable, ordinary copy.
 * - `not-enabled` — the endpoint answered 404. Unpickable, and it borrows
 *   `describeUnavailable()` so this card and the scan screen cannot drift into
 *   two different explanations of one fact.
 * - `unknown` — the probe itself failed, which is evidence of NOTHING. Left
 *   pickable and said so: a proxy that rewrites errors must not be able to hide
 *   a working feature, and the POST is the only authority. Picking it costs a
 *   navigation, not a clone.
 */
function cloneTierOption(
  availability: GithubScanAvailability,
): ChoiceCardOption<BrownfieldTier> {
  const base = {
    value: "clone" as const,
    label: "Public repo URL",
    description: CLONE_DESCRIPTION,
    warning: "Not for client engagements.",
    Icon: Github,
  };

  if (availability === "checking") {
    return {
      ...base,
      disabled: true,
      unavailableReason:
        "Checking whether this deployment runs server-side scanning. This card unlocks as soon as the check answers.",
    };
  }

  if (availability === "not-enabled") {
    const off = describeUnavailable();
    return {
      ...base,
      disabled: true,
      unavailableReason: `${off.detail} ${off.hint}`,
    };
  }

  if (availability === "unknown") {
    return {
      ...base,
      description: `${CLONE_DESCRIPTION} We could not confirm that this deployment runs the scan endpoint — the check itself failed, which is not evidence either way. Picking this opens the scan screen, which says so plainly if the endpoint is not there; nothing is cloned until you start a scan.`,
    };
  }

  return base;
}

export function brownfieldTierOptions(
  cloneAvailability: GithubScanAvailability,
): readonly ChoiceCardOption<BrownfieldTier>[] {
  return [
    {
      value: "artifacts",
      label: "Artifacts only — recommended",
      description:
        "You run `npx hexagen scan --handoff` on your own machine and upload the handoff zip. No source code is uploaded; file paths, package names and rule findings are.",
      badge: HANDOFF_STRIP,
      Icon: Braces,
    },
    cloneTierOption(cloneAvailability),
    {
      value: "zip",
      label: "Upload a zip",
      description: `Upload a zip of the repository. Same retention as above — scanned in a temporary directory, then deleted. Max ${TIER_C_MAX_MIB} MB.`,
      Icon: FolderSearch,
    },
  ];
}

export interface TierPickerViewProps {
  /** The tier the user has picked, or null before the first pick. */
  tier: BrownfieldTier | null;
  onSelectTier: (tier: BrownfieldTier) => void;
  /** Name carried in from the shared project-name step, shown for orientation. */
  projectName: string;
  /**
   * What the deployment answered about the Tier-B endpoint. Supplied by the
   * boundary component, which owns the probe — this view stays presentational
   * and does no I/O of its own. Required rather than defaulted: a default would
   * let a caller that forgot to probe render a confident-looking card.
   */
  cloneAvailability: GithubScanAvailability;
}

export function TierPickerView({
  tier,
  onSelectTier,
  projectName,
  cloneAvailability,
}: TierPickerViewProps) {
  const options = brownfieldTierOptions(cloneAvailability);
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
          options={options}
          value={tier}
          onSelect={onSelectTier}
        />
      </div>
    </div>
  );
}
