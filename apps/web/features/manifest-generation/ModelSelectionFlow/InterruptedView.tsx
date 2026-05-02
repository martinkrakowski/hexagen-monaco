"use client";

import { Button, Icon } from "@hexagen/ui";

interface InterruptedViewProps {
  onRetry: () => void;
  onCancel: () => void;
}

export function InterruptedView({ onRetry, onCancel }: InterruptedViewProps) {
  return (
    <div className="flex flex-col items-center text-center space-y-6">
      <div className="rounded-full bg-warning/20 p-3 w-12 h-12 flex items-center justify-center">
        <Icon name="warning" className="h-6 w-6 text-warning" />
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-medium">Download Interrupted</h3>
        <p className="text-sm text-muted-foreground">
          The model download was paused. You can retry the download or continue
          without AI assistance.
        </p>
      </div>

      <div className="w-full space-y-4">
        <div className="bg-muted/50 rounded-lg p-4">
          <h4 className="font-medium mb-2 flex items-center">
            <Icon name="info" className="mr-2 h-4 w-4 text-info" />
            What happens next?
          </h4>
          <ul className="text-sm text-muted-foreground space-y-2 list-disc pl-5">
            <li>If you retry, the download will resume where it left off</li>
            <li>Partial downloads are saved for future use</li>
            <li>If you continue without AI, you can use cloud options later</li>
          </ul>
        </div>
      </div>

      <div className="w-full grid grid-cols-2 gap-3">
        <Button variant="outline" onClick={onCancel} className="w-full">
          Continue Without AI
        </Button>
        <Button onClick={onRetry} className="w-full">
          <Icon name="refresh" className="mr-2 h-4 w-4" />
          Retry Download
        </Button>
      </div>
    </div>
  );
}
