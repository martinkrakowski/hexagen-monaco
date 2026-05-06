"use client";

import { useState, useCallback } from "react";
import { HardDrive, Trash2 } from "lucide-react";
import { Button } from "@hexagen/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@hexagen/ui";
import { useStorageQuota } from "@/hooks/useStorageQuota";
import { useSavedProjects } from "@/hooks/useSavedProjects";

export function StorageQuotaToast() {
  const {
    isNearQuota,
    usedBytes,
    totalBytes,
    usagePercent,
    trimOldSessions,
    lruProjectIds,
  } = useStorageQuota();
  const { projects, deleteProject } = useSavedProjects();
  const [dismissed, setDismissed] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [trimResult, setTrimResult] = useState<number | null>(null);

  const handleManage = useCallback(() => {
    setManageOpen(true);
  }, []);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  const handleTrim = useCallback(() => {
    const count = trimOldSessions();
    setTrimResult(count);
  }, [trimOldSessions]);

  const handleDeleteProject = useCallback(
    (id: string) => {
      deleteProject(id);
    },
    [deleteProject],
  );

  if (!isNearQuota) {
    if (dismissed) setDismissed(false);
    return null;
  }

  if (dismissed) return null;

  const usedMB = (usedBytes / (1024 * 1024)).toFixed(1);
  const totalMB = (totalBytes / (1024 * 1024)).toFixed(0);
  const barPercent = Math.min(usagePercent, 100);
  const barColor = usagePercent >= 95 ? "bg-destructive" : "bg-yellow-500";

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 flex items-center gap-3 bg-card border border-border rounded-lg shadow-lg px-4 py-3 max-w-sm"
      >
        <HardDrive className="w-5 h-5 text-yellow-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            Storage almost full ({usedMB}/{totalMB} MB)
          </p>
          <p className="text-xs text-muted-foreground">
            {usagePercent.toFixed(0)}% used — consider freeing space
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleManage}>
          Manage Storage
        </Button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={handleDismiss}
          className="text-muted-foreground hover:text-foreground ml-1"
        >
          &times;
        </button>
      </div>

      <Dialog open={manageOpen} onClose={() => setManageOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage Storage</DialogTitle>
            <DialogDescription>
              Free up localStorage space by removing old data.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>Usage</span>
                <span>
                  {usedMB} / {totalMB} MB
                </span>
              </div>
              <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${barColor}`}
                  style={{ width: `${barPercent}%` }}
                />
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium mb-2">
                Oldest saved projects
              </h3>
              {lruProjectIds.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No saved projects
                </p>
              ) : (
                <ul className="space-y-1 max-h-40 overflow-y-auto">
                  {lruProjectIds.map((id) => {
                    const project = projects.find((p) => p.id === id);
                    if (!project) return null;
                    return (
                      <li
                        key={id}
                        className="flex items-center justify-between text-sm py-1"
                      >
                        <span className="truncate">{project.name}</span>
                        <button
                          type="button"
                          aria-label={`Delete ${project.name}`}
                          onClick={() => handleDeleteProject(id)}
                          className="p-1 hover:bg-destructive/20 rounded"
                        >
                          <Trash2 className="w-3 h-3 text-destructive" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTrim}
                className="w-full"
              >
                Trim old sessions (30+ days)
              </Button>
              {trimResult !== null && (
                <p className="text-xs text-muted-foreground mt-1">
                  Removed {trimResult} old session{trimResult !== 1 ? "s" : ""}.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setManageOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
