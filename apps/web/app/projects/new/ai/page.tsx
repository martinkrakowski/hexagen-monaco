import { Suspense } from "react";
import { AIGenerationPageClient } from "./AIGenerationPageClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense>
      <AIGenerationPageClient />
    </Suspense>
  );
}
