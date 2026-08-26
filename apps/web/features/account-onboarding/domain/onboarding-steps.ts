/** Identifiers for the six account-onboarding wizard steps (P-U4). */
export type OnboardingStepId =
  | "welcome"
  | "workspace"
  | "org"
  | "team"
  | "invites"
  | "done";

/** A labelled step in the onboarding flow — the shape `Stepper` consumes. */
export interface OnboardingStep {
  readonly id: OnboardingStepId;
  readonly label: string;
  readonly step: number;
}

/**
 * The onboarding step ledger. Order IS the flow: Welcome → Workspace →
 * Organization → Team → Invites → Done. Every step is skippable (D-U4 —
 * skipping counts as completing), so the ledger describes the rail, not a
 * wall.
 */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  { id: "welcome", label: "Welcome", step: 1 },
  { id: "workspace", label: "Workspace", step: 2 },
  { id: "org", label: "Organization", step: 3 },
  { id: "team", label: "Team", step: 4 },
  { id: "invites", label: "Invites", step: 5 },
  { id: "done", label: "Done", step: 6 },
] as const;

/**
 * Route for each step. Kept as a colocated map (rather than derived from the
 * id) so a route rename is an explicit ledger edit that the sibling
 * route-existence test can catch in both directions — the creation-path
 * ratchet pattern (features/landing/domain/creation-path.test.ts).
 */
export const ONBOARDING_STEP_HREFS: Record<OnboardingStepId, string> = {
  welcome: "/onboarding/welcome",
  workspace: "/onboarding/workspace",
  org: "/onboarding/org",
  team: "/onboarding/team",
  invites: "/onboarding/invites",
  done: "/onboarding/done",
} as const;

/**
 * Route lookup that FAILS FAST on an unknown id (the `stepIndexById`
 * precedent, features/project-wizard/config.ts): containers navigate on this
 * value, so a renamed step must surface immediately rather than silently
 * producing `undefined` and a broken push.
 */
export function stepHref(id: OnboardingStepId): string {
  const href = ONBOARDING_STEP_HREFS[id];
  if (!href) {
    throw new Error(
      `stepHref: unknown onboarding step id "${id}" — check ONBOARDING_STEPS.`,
    );
  }
  return href;
}
