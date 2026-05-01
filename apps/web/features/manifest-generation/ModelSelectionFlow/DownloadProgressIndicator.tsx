"use client";

import { useEffect, useState } from "react";
import { Button, Icon } from "@hexagen/ui";

interface DownloadProgressIndicatorProps {
  progress: number;
  phase?: string;
  onCancel: () => void;
}

export function DownloadProgressIndicator({
  progress,
  phase = "downloading",
  onCancel,
}: DownloadProgressIndicatorProps) {
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<string | null>(null);
  const [lastProgress, setLastProgress] = useState<number>(0);
  const [progressVelocity, setProgressVelocity] = useState<number>(0);
  const [lastUpdateTime, setLastUpdateTime] = useState<number>(Date.now());

  // Translate the technical phase into user-friendly text
  const phaseDisplay = (() => {
    switch (phase) {
      case "downloading":
        return "Downloading model files";
      case "extracting":
      case "initializing":
        return "Preparing model";
      case "compiling":
        return "Compiling shaders";
      case "loading":
        return "Loading model weights";
      default:
        return "Preparing model";
    }
  })();

  // Calculate estimated time remaining
  useEffect(() => {
    if (progress > lastProgress) {
      const now = Date.now();
      const timeElapsed = now - lastUpdateTime;
      
      if (timeElapsed > 500) { // Only update calculations every 500ms
        const progressDelta = progress - lastProgress;
        const velocity = progressDelta / timeElapsed;
        
        // Use a weighted average to smooth out velocity
        const newVelocity = progressVelocity * 0.7 + velocity * 0.3;
        setProgressVelocity(newVelocity);
        
        // Only show estimate if we have meaningful velocity data
        if (newVelocity > 0) {
          const remainingProgress = 1 - progress;
          const estimatedMs = remainingProgress / newVelocity;
          
          let timeString: string;
          if (estimatedMs < 60000) {
            timeString = "Less than a minute";
          } else if (estimatedMs < 3600000) {
            const minutes = Math.ceil(estimatedMs / 60000);
            timeString = `About ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
          } else {
            const hours = Math.ceil(estimatedMs / 3600000);
            timeString = `About ${hours} ${hours === 1 ? "hour" : "hours"}`;
          }
          
          setEstimatedTimeRemaining(timeString);
        }
        
        setLastProgress(progress);
        setLastUpdateTime(now);
      }
    }
  }, [progress, lastProgress, lastUpdateTime, progressVelocity]);

  // Format percentage display
  const percentComplete = Math.round(progress * 100);

  return (
    <div className="flex flex-col space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-medium mb-2">{phaseDisplay}</h3>
        <p className="text-sm text-muted-foreground mb-6">
          {phase === "downloading" ? (
            <>Downloading model files from HuggingFace. This may take a while depending on your connection.</>
          ) : (
            <>Setting up the model on your device. This will be faster next time.</>
          )}
        </p>
      </div>

      <div className="relative pt-1">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold inline-block text-primary">
            {percentComplete}% Complete
          </span>
          {estimatedTimeRemaining && (
            <span className="text-xs font-semibold inline-block text-muted-foreground">
              {estimatedTimeRemaining} remaining
            </span>
          )}
        </div>
        <div className="overflow-hidden h-2 mb-4 text-xs flex rounded bg-muted">
          <div 
            style={{ width: `${percentComplete}%` }}
            className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-primary transition-all duration-300"
          />
        </div>
      </div>

      <div className="flex flex-col space-y-3">
        <div className="flex items-center text-sm">
          <div className={`h-4 w-4 mr-2 ${phase === "downloading" ? "text-primary" : "text-muted"}`}>
            <Icon name="download" />
          </div>
          <span className={phase === "downloading" ? "text-primary font-medium" : "text-muted-foreground"}>
            Download model files
          </span>
        </div>
        
        <div className="flex items-center text-sm">
          <div className={`h-4 w-4 mr-2 ${phase === "compiling" ? "text-primary" : "text-muted"}`}>
            <Icon name="settings" />
          </div>
          <span className={phase === "compiling" ? "text-primary font-medium" : "text-muted-foreground"}>
            Compile shaders
          </span>
        </div>
        
        <div className="flex items-center text-sm">
          <div className={`h-4 w-4 mr-2 ${phase === "loading" ? "text-primary" : "text-muted"}`}>
            <Icon name="settings" />
          </div>
          <span className={phase === "loading" ? "text-primary font-medium" : "text-muted-foreground"}>
            Initialize model
          </span>
        </div>
      </div>

      <div className="mt-6">
        <Button variant="outline" onClick={onCancel} className="w-full">
          <Icon name="x" className="mr-2 h-4 w-4" />
          Cancel Download
        </Button>
        <p className="text-xs text-center text-muted-foreground mt-3">
          You can cancel safely. Progress will be saved for next time.
        </p>
      </div>
    </div>
  );
}