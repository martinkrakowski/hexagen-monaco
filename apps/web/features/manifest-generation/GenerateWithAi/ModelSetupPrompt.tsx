"use client";

import { Cpu } from "lucide-react";
import { Button } from "@hexagen/ui";

interface ModelSetupPromptProps {
  onSetupModel: () => void;
}

export function ModelSetupPrompt({ onSetupModel }: ModelSetupPromptProps) {
  return (
    <div className="p-4 rounded-lg bg-warning/10 border border-warning/20 space-y-3">
      <div className="flex items-start gap-2 text-warning">
        <Cpu className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="text-sm font-semibold">No AI model configured</p>
          <p className="text-sm text-muted-foreground">
            Add a cloud API key (BYOK) or enable local generation with WebLLM to
            use AI features.
          </p>
        </div>
      </div>
      <div className="pl-6">
        <Button variant="outline" size="sm" onClick={onSetupModel}>
          Configure model
        </Button>
      </div>
    </div>
  );
}
