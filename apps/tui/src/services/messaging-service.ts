import fs from "node:fs";
import path from "node:path";

export interface MessagingEvents {
  onBoundaryViolated: () => Promise<void>;
  onDependencyChanged: () => Promise<void>;
}

export class MessagingService {
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;

  start(workspaceRoot: string, events: MessagingEvents): void {
    const manifestPath = path.join(
      workspaceRoot,
      ".architecture",
      "manifest.yaml",
    );

    this.watcher = fs.watch(manifestPath, () => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(async () => {
        await events.onDependencyChanged();
        await events.onBoundaryViolated();
      }, 350);
    });
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
