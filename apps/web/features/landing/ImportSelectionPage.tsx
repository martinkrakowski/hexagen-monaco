"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@hexagen/ui";
import { ProjectsShell } from "@/landing/ProjectsShell";
import { CreationStepIndicator } from "@/landing/components/CreationStepIndicator";
import { ImportOptionRow } from "@/landing/components/ImportOptionRow";
import {
  CREATION_STEPS,
  IMPORT_SUB_OPTIONS,
} from "@/landing/domain/creation-path";

interface ImportSelectionPageProps {
  readonly router?: { push: (url: string) => void };
}

export function ImportSelectionPage({
  router: injectedRouter,
}: ImportSelectionPageProps) {
  const defaultRouter = useRouter();
  const router = injectedRouter ?? defaultRouter;

  return (
    <ProjectsShell
      title="Import Project"
      footer={
        <Button variant="outline" onClick={() => router.push("/projects/new")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="flex items-center justify-center min-h-full py-6 sm:py-12">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 w-full">
            <CreationStepIndicator currentStep={1} steps={CREATION_STEPS} />

            <div className="text-center mb-10 animate-fade-in-up delay-100">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
                Choose Import Type
              </h1>
              <p className="text-muted-foreground max-w-md mx-auto leading-relaxed">
                Select the format of your existing project definition.
              </p>
            </div>

            <div className="flex flex-col gap-3 animate-fade-in-up delay-200">
              {IMPORT_SUB_OPTIONS.map((option) => (
                <ImportOptionRow
                  key={option.id}
                  option={option}
                  router={injectedRouter}
                />
              ))}
            </div>

            <p className="text-center mt-8 text-xs text-muted-foreground">
              All paths produce an editable, standards-compliant manifest
            </p>
          </div>
        </div>
      </div>
    </ProjectsShell>
  );
}
