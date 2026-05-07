"use client";

import { Sparkles, Upload, Wand2 } from "lucide-react";
import { Button } from "@hexagen/ui";

interface EmptyProjectsHeroProps {
  onOpenWelcomeDialog: () => void;
  onImportManifest: () => void;
  onStartWizard: () => void;
}

export function EmptyProjectsHero({
  onOpenWelcomeDialog,
  onImportManifest,
  onStartWizard,
}: EmptyProjectsHeroProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 animate-fade-in-up">
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
            Welcome to HexaGen Monaco
          </h2>
          <p className="text-sm text-muted-foreground">
            Design and generate production-ready hexagonal monorepos with DDD
            principles. Start by describing your project, importing a manifest,
            or using the step-by-step wizard.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Button onClick={onOpenWelcomeDialog} size="lg" className="w-full">
            <Sparkles className="h-4 w-4 mr-2" />
            Generate with AI
          </Button>

          <Button
            variant="outline"
            onClick={onStartWizard}
            size="lg"
            className="w-full"
          >
            <Wand2 className="h-4 w-4 mr-2" />
            Start Wizard
          </Button>

          <Button
            variant="outline"
            onClick={onImportManifest}
            size="lg"
            className="w-full"
          >
            <Upload className="h-4 w-4 mr-2" />
            Import Manifest
          </Button>
        </div>
      </div>
    </div>
  );
}
