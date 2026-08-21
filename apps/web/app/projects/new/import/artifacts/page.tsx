import { redirect } from "next/navigation";

/**
 * Placeholder for the Tier-A artifact-upload screen (BF-3.3).
 *
 * NameStepClient already routes `?path=artifacts` here, and the route has to
 * exist before that navigation does — otherwise submitting the name step from
 * a shared or bookmarked `/projects/new/name?path=artifacts` URL lands on a
 * 404. The funnel itself cannot reach this yet (the sub-option is
 * `coming-soon`), but a direct visit can.
 *
 * Mirrors the `import/github` placeholder. BF-3.3 replaces this file with the
 * real screen and flips the sub-option to `available` in the same packet.
 */
export default function ImportArtifactsPage() {
  redirect("/projects/new/import");
}
