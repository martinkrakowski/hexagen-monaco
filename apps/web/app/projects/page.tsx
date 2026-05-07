import { Suspense } from "react";

import { ProjectsLandingShell } from "./ProjectsLandingShell";

export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsLandingShell />
    </Suspense>
  );
}
