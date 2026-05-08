"use client";

import { useRouter } from "next/navigation";
import { Sparkles, Upload, Wand2 } from "lucide-react";
import { Button } from "@hexagen/ui";
import { useSavedProjects } from "@/hooks/useSavedProjects";
import { ProjectsShell } from "@/landing/ProjectsShell";
import type { ProjectConfig } from "@hexagen/project-configuration";

const blankProjectConfig: ProjectConfig = {
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
};

export function NewProjectPage() {
  const router = useRouter();
  const { saveProject } = useSavedProjects();

  const handleGenerateWithAI = () => {
    router.push("/projects/new/ai");
  };

  const handleImportManifest = () => {
    router.push("/projects/new/import");
  };

  const handleStartBlank = () => {
    const projectId = saveProject("Untitled Project", blankProjectConfig, "");
    router.push(`/wizard/1?project=${projectId}`);
  };

  return (
    <ProjectsShell
      title="New Project"
      footer={
        <>
          <span />
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={handleStartBlank}>
              <Wand2 className="h-4 w-4 mr-2" />
              Start Blank
            </Button>
            <Button onClick={handleImportManifest}>
              <Upload className="h-4 w-4 mr-2" />
              Import Manifest
            </Button>
            <Button onClick={handleGenerateWithAI}>
              <Sparkles className="h-4 w-4 mr-2" />
              Generate with AI
            </Button>
          </div>
        </>
      }
    >
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center p-8">
        <div className="rounded-lg border border-border bg-card p-8 max-w-lg w-full text-center space-y-6">
          <div className="flex justify-center">
            <div className="bg-cinematic-border-vivid rounded-full p-3 animate-spin-border">
              <div className="bg-card rounded-full p-3">
                <Sparkles className="h-8 w-8 text-primary" />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-foreground">
              Choose Your Creation Path
            </h2>
            <p className="text-sm text-muted-foreground">
              Design and generate production-ready hexagonal monorepos with DDD
              principles. Select your preferred method to get started.
            </p>
          </div>
        </div>
      </div>
    </ProjectsShell>
  );
}
