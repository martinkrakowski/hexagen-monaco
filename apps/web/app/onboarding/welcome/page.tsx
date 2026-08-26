import { WelcomeClient } from "./WelcomeClient";

// No Suspense: WelcomeClient does not read useSearchParams. Nothing from
// @hexagen/ui is imported here — see app/login/LoginFallback.tsx for why a
// server page.tsx must not touch hook-using modules (breaks `next build`).
export default function OnboardingWelcomePage() {
  return <WelcomeClient />;
}
