"use client";

import { useState } from "react";
import { Cpu } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { useHardwareDetection } from "@/hooks/useHardwareDetection";

function formatMB(mb: number | null): string {
  if (mb === null) return "Not available";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-foreground/90">{value}</span>
    </div>
  );
}

export function SystemInfoButton() {
  const [open, setOpen] = useState(false);
  const { profile, isDetecting } = useHardwareDetection();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground/80 hover:bg-muted/60 transition-colors"
        title="System information"
        aria-label="System information"
      >
        <Cpu size={12} strokeWidth={2} />
      </button>

      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>System Information</DialogTitle>
          </DialogHeader>

          {isDetecting || !profile ? (
            <div className="flex items-center justify-center py-6">
              <span className="text-sm text-muted-foreground">
                {isDetecting
                  ? "Detecting hardware..."
                  : "Unable to detect hardware"}
              </span>
            </div>
          ) : (
            <div className="mt-2">
              <SpecRow
                label="Device Type"
                value={
                  profile.deviceClass.charAt(0).toUpperCase() +
                  profile.deviceClass.slice(1)
                }
              />
              <SpecRow label="CPU Cores" value={String(profile.cpuCores)} />
              <SpecRow label="System RAM" value={formatMB(profile.ramMB)} />
              <SpecRow
                label="GPU Vendor"
                value={profile.gpu.vendor ?? "Unknown"}
              />
              <SpecRow
                label="GPU Architecture"
                value={profile.gpu.architecture ?? "Unknown"}
              />
              <SpecRow
                label="WebGPU Support"
                value={profile.gpu.supported ? "Yes" : "No"}
              />
              <SpecRow
                label="Max VRAM"
                value={formatMB(profile.gpu.maxBufferMB)}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
