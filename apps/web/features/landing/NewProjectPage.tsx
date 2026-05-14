"use client";

import { useRouter } from "next/navigation";
import { FolderOpen } from "lucide-react";
import { Button } from "@hexagen/ui";
import { ProjectsShell } from "@/landing/ProjectsShell";
import { useCreationPaths } from "@/landing/application/useCreationPaths";
import { usePathNavigation } from "@/landing/application/usePathNavigation";
import { CreationStepIndicator } from "@/landing/components/CreationStepIndicator";
import { CreationPathGrid } from "@/landing/components/CreationPathGrid";
import { CREATION_STEPS } from "@/landing/domain/creation-path";

export function NewProjectPage() {
  const router = useRouter();
  const options = useCreationPaths();
  const { navigate } = usePathNavigation();

  return (
    <ProjectsShell
      title="New Project"
      footer={
        <div className="flex items-center gap-3 ml-auto">
          <Button variant="ghost" onClick={() => router.push("/projects")}>
            <FolderOpen className="h-4 w-4 mr-2" />
            Saved Projects
          </Button>
        </div>
      }
    >
      <div className="h-full overflow-y-auto dot-grid bg-ambient">
        <div className="flex items-center justify-center min-h-full py-6 sm:py-12">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 w-full">
            <CreationStepIndicator currentStep={1} steps={CREATION_STEPS} />

            <div className="text-center mb-12 animate-fade-in-up delay-100">
              <h1 className="text-2xl sm:text-4xl font-bold tracking-tight mb-4">
                Choose Your Creation Path
              </h1>
              <p className="text-muted-foreground text-lg max-w-lg mx-auto leading-relaxed">
                Design and generate a production-ready hexagonal monorepo
                aligned with DDD principles.
              </p>
            </div>

            <CreationPathGrid options={options} onSelectPath={navigate} />

            <div className="text-center mt-8 text-xs text-muted-foreground">
              All paths produce an editable, standards-compliant manifest
            </div>
          </div>
        </div>
      </div>
    </ProjectsShell>
  );
}
