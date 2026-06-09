import { Suspense } from "react";

import { ImportManifestPage } from "@/manifest-generation/ImportManifestPage";

export default function Page() {
  return (
    <Suspense>
      <ImportManifestPage />
    </Suspense>
  );
}
