"use client";

import { Badge } from "@hexagen/ui";
import { Radio } from "lucide-react";
import type { ProjectLayer } from "@hexagen/shared";

import type { SessionStatus } from "./session/planning-session";
import type { WorkbenchMainView } from "./PlanWorkbench";
import { STATUS_LABELS, statusChipClass } from "./session-status-presentation";

export interface SessionsSourcesListProps {
  /** Archived layers only — the host filters the active session's layer out
   * (it renders as the pinned "Live session" row instead, never twice). */
  layers: readonly ProjectLayer[];
  /** Live session status for the pinned row's chip; null = no session yet. */
  sessionStatus: SessionStatus | null;
  /** Which right-pane view is selected (drives the row highlight). */
  selectedView: WorkbenchMainView;
  onSelectLive: () => void;
  onSelectLayer: (layerId: string) => void;
}

const ROW_BASE_CLASSES =
  "w-full text-left rounded-md px-2 py-2 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function rowClasses(isSelected: boolean): string {
  return `${ROW_BASE_CLASSES} ${isSelected ? "bg-muted" : ""}`;
}

/**
 * Section B of the workbench's left pane: the pinned "Live session" row plus
 * the archived planning layers, NEWEST first (a returning user looks for the
 * latest session, not the oldest). Rows only SELECT the right-pane view —
 * every action on a layer (rename/extract/delete) lives in the reader.
 */
export function SessionsSourcesList({
  layers,
  sessionStatus,
  selectedView,
  onSelectLive,
  onSelectLayer,
}: SessionsSourcesListProps) {
  const newestFirst = [...layers].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <nav aria-label="Sessions and sources" className="space-y-1">
      <button
        type="button"
        onClick={onSelectLive}
        aria-current={selectedView.kind === "live" ? "true" : undefined}
        className={rowClasses(selectedView.kind === "live")}
      >
        <span className="flex items-center gap-2">
          <Radio aria-hidden="true" className="w-3.5 h-3.5 text-primary" />
          <span className="text-sm font-medium text-foreground">
            Live session
          </span>
          {sessionStatus !== null && (
            <span
              data-testid="session-row-status-chip"
              className={`text-xs px-2 py-0.5 rounded border font-medium ${statusChipClass(sessionStatus)}`}
            >
              {STATUS_LABELS[sessionStatus]}
            </span>
          )}
        </span>
      </button>

      {newestFirst.length === 0 ? (
        <p className="text-xs text-muted-foreground px-2 py-1.5">
          No archived sessions yet — pasted or finished sessions appear here.
        </p>
      ) : (
        newestFirst.map((layer) => {
          const isSelected =
            selectedView.kind === "layer" && selectedView.layerId === layer.id;
          const isDecisions = layer.kind === "decisions";
          return (
            <button
              key={layer.id}
              type="button"
              onClick={() => onSelectLayer(layer.id)}
              aria-current={isSelected ? "true" : undefined}
              className={rowClasses(isSelected)}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="text-sm text-foreground truncate">
                  {layer.title}
                </span>
                <Badge variant={isDecisions ? "default" : "secondary"}>
                  {isDecisions ? "Decisions" : "Brainstorm"}
                </Badge>
                {layer.link?.type === "produced-manifest" && (
                  <Badge variant="outline">Produced this architecture</Badge>
                )}
              </span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                {layer.turns.length}{" "}
                {layer.turns.length === 1 ? "turn" : "turns"}
                {" · updated "}
                {/* Locale/timezone-dependent text node — scoped hydration
                    tolerance, the repo's pattern for toLocaleString() output. */}
                <span suppressHydrationWarning>
                  {new Date(layer.updatedAt).toLocaleString()}
                </span>
              </span>
            </button>
          );
        })
      )}
    </nav>
  );
}
