import { WorkspaceClient } from "./WorkspaceClient";

// No Suspense: WorkspaceClient does not read useSearchParams.
export default function OnboardingWorkspacePage() {
  return <WorkspaceClient />;
}
