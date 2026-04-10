"use client";

import { CardContent } from "@/components/ui/Card";
import { Tabs } from "@/components/ui/Tabs";
import {
  AlertTriangle,
  CheckCircle,
  Lightbulb,
  RefreshCw,
  Loader2,
} from "lucide-react";

interface Violation {
  id: string;
  type: "error" | "warning" | "info";
  message: string;
  context?: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
}

interface AISuggestion {
  id: string;
  message: string;
  confidence: number;
  category:
    | "context-split"
    | "port-definition"
    | "dependency-cleanup"
    | "general";
}

interface PortAdapterStatus {
  context: string;
  ports: number;
  adapters: number;
  complete: boolean;
}

interface AIGovernancePanelProps {
  violations?: Violation[];
  suggestions?: AISuggestion[];
  portAdapterStatus?: PortAdapterStatus[];
  onRefresh?: () => void;
  isLoading?: boolean;
}

export function AIGovernancePanel({
  violations = mockViolations,
  suggestions = mockSuggestions,
  portAdapterStatus = mockPortAdapterStatus,
  onRefresh,
  isLoading = false,
}: AIGovernancePanelProps) {
  return (
    <div className="flex flex-col h-full bg-card">
      <Tabs.Root defaultTab="violations">
        <Tabs.List>
          <Tabs.Trigger value="violations">
            Violations ({violations.length})
          </Tabs.Trigger>
          <Tabs.Trigger value="suggestions">
            AI Suggestions ({suggestions.length})
          </Tabs.Trigger>
          <Tabs.Trigger value="status">Port/Adapter Status</Tabs.Trigger>
        </Tabs.List>

        <div className="flex justify-end px-2 py-1 border-b border-border shrink-0">
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
          >
            {isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {isLoading ? "Analyzing..." : "Refresh"}
          </button>
        </div>

        <CardContent className="flex-1 overflow-auto p-3">
          <Tabs.Content value="violations">
            <ViolationList violations={violations} />
          </Tabs.Content>
          <Tabs.Content value="suggestions">
            <SuggestionList suggestions={suggestions} />
          </Tabs.Content>
          <Tabs.Content value="status">
            <PortAdapterStatusList status={portAdapterStatus} />
          </Tabs.Content>
        </CardContent>
      </Tabs.Root>
    </div>
  );
}

function ViolationList({ violations }: { violations: Violation[] }) {
  if (violations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <CheckCircle className="h-8 w-8 text-green-500 mb-2" />
        <p className="text-sm">No violations detected</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {violations.map((violation) => (
        <div
          key={violation.id}
          className={`p-3 rounded-lg border ${
            violation.severity === "HIGH"
              ? "bg-red-500/10 border-red-500/30"
              : violation.severity === "MEDIUM"
                ? "bg-orange-500/10 border-orange-500/30"
                : "bg-blue-500/10 border-blue-500/30"
          }`}
        >
          <div className="flex items-start gap-2">
            <AlertTriangle
              className={`h-4 w-4 mt-0.5 shrink-0 ${
                violation.severity === "HIGH"
                  ? "text-red-500"
                  : violation.severity === "MEDIUM"
                    ? "text-orange-500"
                    : "text-blue-500"
              }`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                {violation.message}
              </p>
              {violation.context && (
                <p className="text-xs text-muted-foreground mt-1 font-mono">
                  {violation.context}
                </p>
              )}
              <span
                className={`inline-block mt-2 px-1.5 py-0.5 text-xs rounded ${
                  violation.severity === "HIGH"
                    ? "bg-red-500/20 text-red-400"
                    : violation.severity === "MEDIUM"
                      ? "bg-orange-500/20 text-orange-400"
                      : "bg-blue-500/20 text-blue-400"
                }`}
              >
                {violation.severity}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SuggestionList({ suggestions }: { suggestions: AISuggestion[] }) {
  if (suggestions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Lightbulb className="h-8 w-8 mb-2" />
        <p className="text-sm">No suggestions available</p>
        <p className="text-xs mt-1">Run AI analysis to get recommendations</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {suggestions.map((suggestion) => (
        <div
          key={suggestion.id}
          className="p-3 rounded-lg border bg-cyan-500/10 border-cyan-500/30"
        >
          <div className="flex items-start gap-2">
            <Lightbulb className="h-4 w-4 mt-0.5 shrink-0 text-cyan-400" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground">{suggestion.message}</p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-muted-foreground capitalize">
                  {suggestion.category.replace("-", " ")}
                </span>
                <span className="text-xs text-cyan-400">
                  {suggestion.confidence}% confidence
                </span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PortAdapterStatusList({ status }: { status: PortAdapterStatus[] }) {
  return (
    <div className="space-y-2">
      {status.map((item) => (
        <div key={item.context} className="p-3 rounded-lg border border-border">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">
              {item.context}
            </span>
            {item.complete ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-orange-500" />
            )}
          </div>
          <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
            <span>Ports: {item.ports}</span>
            <span>Adapters: {item.adapters}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Mock data for demonstration
const mockViolations: Violation[] = [
  {
    id: "1",
    type: "error",
    message: "Cyclic dependency detected",
    context: "wizard-orchestration → messaging → wizard-orchestration",
    severity: "HIGH",
  },
  {
    id: "2",
    type: "warning",
    message: "Port Adapter Gap",
    context: "agentic-interaction: missing ManifestReaderPort implementation",
    severity: "MEDIUM",
  },
  {
    id: "3",
    type: "warning",
    message: "Unused port detected",
    context: "monaco-orchestration: UndoLastPatchPort has no consumers",
    severity: "LOW",
  },
];

const mockSuggestions: AISuggestion[] = [
  {
    id: "1",
    message:
      "Consider splitting 'agentic-interaction' into two contexts: governance and provider-integration",
    confidence: 87,
    category: "context-split",
  },
  {
    id: "2",
    message:
      "Add an Anti-Corruption Layer between visualization and sync contexts",
    confidence: 72,
    category: "dependency-cleanup",
  },
  {
    id: "3",
    message:
      "Define a new port 'ArchitecturalSnapshotPort' in persistence for versioning",
    confidence: 65,
    category: "port-definition",
  },
];

const mockPortAdapterStatus: PortAdapterStatus[] = [
  { context: "shared", ports: 2, adapters: 0, complete: false },
  { context: "project-configuration", ports: 5, adapters: 3, complete: false },
  { context: "sync", ports: 1, adapters: 2, complete: true },
  { context: "wizard-orchestration", ports: 4, adapters: 1, complete: false },
  { context: "monaco-orchestration", ports: 4, adapters: 2, complete: false },
  { context: "visualization", ports: 2, adapters: 1, complete: false },
  { context: "messaging", ports: 2, adapters: 0, complete: false },
  { context: "persistence", ports: 0, adapters: 0, complete: true },
  { context: "agentic-interaction", ports: 2, adapters: 0, complete: false },
  { context: "web-driver", ports: 1, adapters: 3, complete: true },
  { context: "project-generation", ports: 1, adapters: 2, complete: true },
];
