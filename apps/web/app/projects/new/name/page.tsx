import { Suspense } from "react";

import { NameStepClient } from "./NameStepClient";

export default function NewProjectNamePage() {
  return (
    <Suspense>
      <NameStepClient />
    </Suspense>
  );
}
