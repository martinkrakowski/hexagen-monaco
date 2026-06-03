"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { CreationPathId } from "../domain/creation-path";
import { useSavedProjects } from "@/hooks/useSavedProjects";
import type { ProjectConfig } from "@hexagen/project-configuration";

function createBlankProjectConfig(): ProjectConfig {
  return {
    governance: {
      workspaceName: "@hexagen",
      workspaceTemplate: "modular-monolith",
      workspaceDescription: undefined,
      packageManager: "yarn",
      topologyStrictness: "flexible",
      namespacePrefix: "@hexagen",
      namingConventions: {
        contextDirectoryPattern: "packages/",
        adapterSuffix: ".adapter.ts",
      },
    },
    boundedContexts: [
      {
        id: crypto.randomUUID(),
        name: "core",
        description: "",
        infrastructureTarget: "nestjs",
        coreDomainEntities: [],
        valueObjects: [],
        domainEvents: [],
        entities: [],
        useCases: [],
        portConfiguration: {
          inboundPorts: [],
          outboundPorts: [],
        },
        uiFramework: "",
        persistenceAdapter: "",
        messagingAdapter: "",
        telemetryProvider: "",
      },
    ],
    externalContexts: [],
    peerMappings: [],
    addOnsAnswers: {},
  };
}

export function usePathNavigation() {
  const router = useRouter();
  const { saveProject } = useSavedProjects();
  const [navigationError, setNavigationError] = useState<string | null>(null);

  const navigate = useCallback(
    async (pathId: CreationPathId) => {
      setNavigationError(null);
      switch (pathId) {
        case "blank": {
          const projectId = await saveProject(
            "Untitled Project",
            createBlankProjectConfig(),
            "",
          );
          if (projectId) {
            router.push(`/wizard/1?project=${projectId}`);
          } else {
            // Persistence failed (saveProject returned null) — surface it
            // instead of silently doing nothing.
            console.error("Failed to create blank project: persistence failed");
            setNavigationError(
              "Couldn't create the project — check your browser storage permissions or available space and try again.",
            );
          }
          break;
        }
        case "import":
          router.push("/projects/new/import");
          break;
        case "ai":
          router.push("/projects/new/ai");
          break;
        default: {
          const _exhaustive: never = pathId;
          throw new Error(`Unhandled creation path: ${_exhaustive}`);
        }
      }
    },
    [router, saveProject],
  );

  return { navigate, navigationError };
}
