import { postJson } from "@/lib/fetch-json";

/**
 * Mark onboarding complete and leave for the workspace. Shared by every
 * step's Skip and by Done's "Go to your workspace" — skipping counts as
 * completing (D-U5: the flag is server-side; D-U4: skip == complete).
 *
 * The navigation deliberately does NOT depend on the POST succeeding:
 * onboarding must never strand a user in the wizard. If the completion write
 * fails, the worst case is being offered onboarding again at the next
 * sign-in — the route's idempotent `markOnboarded` makes a replay harmless.
 *
 * `replace`, not `push`: Back from the workspace must not return into a
 * wizard the user just left.
 */
export async function completeOnboardingAndGo(router: {
  replace: (url: string) => void;
}): Promise<void> {
  await postJson("/api/account/onboarding", {});
  router.replace("/projects/new");
}
