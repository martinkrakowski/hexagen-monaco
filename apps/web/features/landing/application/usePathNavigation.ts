"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { CreationPathId } from "../domain/creation-path";

export function usePathNavigation() {
  const router = useRouter();

  const navigate = useCallback(
    (pathId: CreationPathId) => {
      switch (pathId) {
        case "blank":
          // The blank project is named, built, and persisted by the shared
          // Project Name step (NameStepClient) before the wizard opens.
          router.push("/projects/new/name?path=blank");
          break;
        case "import":
          router.push("/projects/new/import");
          break;
        case "ai":
          router.push("/projects/new/name?path=ai");
          break;
        default: {
          const _exhaustive: never = pathId;
          throw new Error(`Unhandled creation path: ${_exhaustive}`);
        }
      }
    },
    [router],
  );

  return { navigate };
}
