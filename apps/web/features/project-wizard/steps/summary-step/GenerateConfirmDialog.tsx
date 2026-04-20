"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@hexagen/ui";

interface GenerateConfirmDialogProps {
  open: boolean;
  boundedContextCount: number;
  peerMappingCount: number;
  totalPorts: number;
  workspaceName?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

interface StatRowProps {
  label: string;
  value: string | number;
  mono?: boolean;
}

function StatRow({ label, value, mono = false }: StatRowProps) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </span>
    </div>
  );
}

/**
 * Final confirmation dialog before project generation. Summarises
 * the key counts (contexts, ports, mappings) so the user can verify
 * the wizard state right before generation kicks off.
 */
export function GenerateConfirmDialog({
  open,
  boundedContextCount,
  peerMappingCount,
  totalPorts,
  workspaceName,
  onConfirm,
  onCancel,
}: GenerateConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate Project</DialogTitle>
          <DialogDescription>
            This will scaffold your project and switch to the code editor view.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <StatRow label="Bounded Contexts" value={boundedContextCount} />
          <StatRow label="Total Ports" value={totalPorts} />
          <StatRow label="Peer Mappings" value={peerMappingCount} />
          {workspaceName && (
            <StatRow label="Workspace" value={workspaceName} mono />
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted/80 rounded-md transition-colors border border-input"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-bold text-primary-foreground bg-primary hover:bg-primary/90 rounded-md shadow-sm transition-colors"
          >
            Generate &amp; Switch to Code View
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
