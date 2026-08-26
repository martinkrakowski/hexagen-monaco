import { redirect } from "next/navigation";

/**
 * The login screen moved into the application shell at /projects/new/login
 * (P-U2 of docs/planning/2026-08-25-login-onboarding-ui-plan.md). This route
 * survives as a redirect because it is a published contract: middleware
 * redirects built before the move, NextAuth error flows, and old links all
 * target /auth/signin?callbackUrl=…
 */
export default async function SignInRoute({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const params = await searchParams;
  const suffix = params.callbackUrl
    ? `?callbackUrl=${encodeURIComponent(params.callbackUrl)}`
    : "";
  redirect(`/projects/new/login${suffix}`);
}
