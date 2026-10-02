import { Suspense } from "react";

import { BrownfieldViewerClient } from "./BrownfieldViewerClient";

export default function BrownfieldViewerRoute() {
  return (
    <Suspense>
      <BrownfieldViewerClient />
    </Suspense>
  );
}
