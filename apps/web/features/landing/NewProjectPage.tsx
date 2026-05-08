"use client";

import { useRouter } from "next/navigation";
import { Sparkles, Upload, Wand2 } from "lucide-react";
import { Button } from "@hexagen/ui";

export function NewProjectPage() {
  const router = useRouter();

  const handleGenerateWithAI = () => {
    router.push("/projects/new/ai");
  };

  const handleImportManifest = () => {
    router.push("/projects/new/import");
  };

  const handleStartBlank = () => {
    // Navigate to wizard with ?new=true to signal a blank start
    // This will trigger useProjectSearchParam to clear activeWorkspace, preventing stale project load
    router.push("/wizard/1?new=true");
  };

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
            Choose Your Creation Path
          </h2>
          <p className="text-sm text-muted-foreground">
            Design and generate production-ready hexagonal monorepos with DDD
            principles. Select your preferred method to get started.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Button onClick={handleGenerateWithAI} size="lg" className="w-full">
            <Sparkles className="h-4 w-4 mr-2" />
            Generate with AI
          </Button>

          <Button
            variant="outline"
            onClick={handleStartBlank}
            size="lg"
            className="w-full"
          >
            <Wand2 className="h-4 w-4 mr-2" />
            Start Blank
          </Button>

          <Button
            variant="outline"
            onClick={handleImportManifest}
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
