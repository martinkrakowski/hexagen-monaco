"use client";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { AlertTriangle, Cpu } from "lucide-react";

interface OptInCardProps {
  onInitialize: () => void;
  isInitializing: boolean;
}

export function OptInCard({ onInitialize, isInitializing }: OptInCardProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 gap-4">
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10">
        <Cpu className="h-6 w-6 text-primary" />
      </div>
      <div className="text-center space-y-2">
        <h3 className="text-base font-semibold">Local AI Assistant</h3>
        <p className="text-sm text-muted-foreground max-w-[260px]">
          Run a 3.8B parameter language model entirely in your browser using
          WebGPU — no data leaves your machine.
        </p>
      </div>
      <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 max-w-[280px]">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-500">
          This will download ~2GB of model weights on first use and require ~4GB
          of VRAM to run.
        </p>
      </div>
      <PrimaryButton
        onClick={onInitialize}
        disabled={isInitializing}
        className="w-full max-w-[200px]"
      >
        {isInitializing ? "Initializing..." : "Enable Local AI"}
      </PrimaryButton>
    </div>
  );
}
