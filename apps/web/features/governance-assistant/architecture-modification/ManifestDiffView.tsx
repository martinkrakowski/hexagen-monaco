"use client";

import { useMemo } from "react";
import { ArrowRight, Plus, Minus } from "lucide-react";

interface ManifestEntry {
  id: string;
  name: string;
  type: "bounded-context" | "port" | "edge";
}

interface ManifestDiffViewProps {
  current: ManifestEntry[];
  proposed: ManifestEntry[];
}

interface DiffEntry {
  id: string;
  name: string;
  type: ManifestEntry["type"];
  change: "added" | "removed" | "unchanged";
}

function computeDiff(
  current: ManifestEntry[],
  proposed: ManifestEntry[],
): DiffEntry[] {
  const currentIds = new Set(current.map((e) => e.id));
  const proposedIds = new Set(proposed.map((e) => e.id));
  const allIds = new Set([...currentIds, ...proposedIds]);
  const currentMap = new Map(current.map((e) => [e.id, e]));
  const proposedMap = new Map(proposed.map((e) => [e.id, e]));

  const diff: DiffEntry[] = [];
  for (const id of allIds) {
    const inCurrent = currentMap.get(id);
    const inProposed = proposedMap.get(id);
    if (inCurrent && inProposed) {
      diff.push({ ...inCurrent, change: "unchanged" });
    } else if (inProposed) {
      diff.push({ ...inProposed, change: "added" });
    } else if (inCurrent) {
      diff.push({ ...inCurrent, change: "removed" });
    }
  }

  const changeOrder: Record<DiffEntry["change"], number> = {
    added: 0,
    removed: 1,
    unchanged: 2,
  };
  diff.sort((a, b) => changeOrder[a.change] - changeOrder[b.change]);
  return diff;
}

function ChangeIcon({ change }: { change: DiffEntry["change"] }) {
  switch (change) {
    case "added":
      return <Plus className="h-3.5 w-3.5 text-success shrink-0" />;
    case "removed":
      return <Minus className="h-3.5 w-3.5 text-destructive shrink-0" />;
    default:
      return null;
  }
}

function TypeBadge({ type }: { type: ManifestEntry["type"] }) {
  const label =
    type === "bounded-context" ? "Context" : type === "port" ? "Port" : "Edge";
  return (
    <span className="text-xs px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground font-mono">
      {label}
    </span>
  );
}

function DiffRow({ entry }: { entry: DiffEntry }) {
  const rowClass =
    entry.change === "added"
      ? "bg-success/5 border-l-2 border-l-success"
      : entry.change === "removed"
        ? "bg-destructive/5 border-l-2 border-l-destructive"
        : "border-l-2 border-l-transparent";

  return (
    <div className={`flex items-center gap-2 px-3 py-2 ${rowClass}`}>
      <ChangeIcon change={entry.change} />
      <TypeBadge type={entry.type} />
      <span
        className={`text-sm font-mono truncate flex-1 ${
          entry.change === "removed"
            ? "line-through text-muted-foreground"
            : "text-foreground"
        }`}
      >
        {entry.name}
      </span>
      <span className="text-xs text-muted-foreground font-mono shrink-0">
        {entry.id}
      </span>
    </div>
  );
}

export function ManifestDiffView({ current, proposed }: ManifestDiffViewProps) {
  const diff = useMemo(
    () => computeDiff(current, proposed),
    [current, proposed],
  );
  const added = useMemo(() => diff.filter((d) => d.change === "added"), [diff]);
  const removed = useMemo(
    () => diff.filter((d) => d.change === "removed"),
    [diff],
  );

  if (diff.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <ArrowRight className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">No manifest changes</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground/60">
          Manifest Changes
        </span>
        {(added.length > 0 || removed.length > 0) && (
          <div className="flex items-center gap-3 text-xs">
            {added.length > 0 && (
              <span className="flex items-center gap-1 text-success">
                <Plus className="h-3 w-3" />
                {added.length} added
              </span>
            )}
            {removed.length > 0 && (
              <span className="flex items-center gap-1 text-destructive">
                <Minus className="h-3 w-3" />
                {removed.length} removed
              </span>
            )}
          </div>
        )}
      </div>
      <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
        {diff.map((entry) => (
          <DiffRow key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}

export type { ManifestEntry, DiffEntry };
