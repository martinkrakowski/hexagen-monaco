"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
} from "@hexagen/ui";
import { AlertTriangle } from "lucide-react";

interface LocalGenerationWarningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Proceed with the explicit local override. */
  onContinueLocal: () => void;
  /** Flip the persisted override to cloud and proceed. */
  onSwitchToCloud: () => void;
}

/**
 * Pre-generate warning, shown on Generate click only when the explicit
 * "local" engine override is active (never for auto-resolved local — see
 * shouldWarnBeforeGenerate).
 */
export function LocalGenerationWarningDialog({
  open,
  onOpenChange,
  onContinueLocal,
  onSwitchToCloud,
}: LocalGenerationWarningDialogProps) {
  return (
    <Dialog open={open} onClose={() => onOpenChange(false)}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle
              className="h-5 w-5 text-amber-500 flex-shrink-0"
              aria-hidden="true"
            />
            <DialogTitle>Generate with local model?</DialogTitle>
          </div>
          <DialogDescription>
            Some stages may fail with WebLLM models; cloud fallback will be used
            if available.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onSwitchToCloud}>
            Switch to cloud
          </Button>
          <Button onClick={onContinueLocal}>Continue with local</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
