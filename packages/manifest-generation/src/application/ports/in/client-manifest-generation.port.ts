import type { ZodSchema } from "zod";
import type { BoundedContextType } from "@hexagen/shared";
import type {
  ManifestTopologyDraft,
  ManifestDraft,
  ClarificationTrigger,
  DraftDiagnostic,
  ContextListEntry,
  PortsList,
  ManifestDraftContext,
} from "@hexagen/agentic-interaction";

export interface ClientManifestGenerationInput {
  description: string;
  maxContexts?: number;
}

export interface ClientManifestGenerationTopologyResult {
  ok: true;
  topology: ManifestTopologyDraft;
  warnings: ClientManifestGenerationWarning[];
}

export interface ClientManifestGenerationWarning {
  code: string;
  context?: string;
  message: string;
  severity: "warning";
}

export interface ClientManifestGenerationAdaptersResult {
  ok: true;
  draft: ManifestDraft;
  diagnostics: DraftDiagnostic[];
}

export type ClientManifestGenerationResult =
  | ClientManifestGenerationTopologyResult
  | { ok: false; error: string };

export type ClientManifestGenerationAdaptersPhaseResult =
  | ClientManifestGenerationAdaptersResult
  | { ok: false; error: string };

export interface ClientManifestGenerationPort {
  generateTopology(
    input: ClientManifestGenerationInput,
    signal?: AbortSignal,
    onStepDetail?: (detail: string) => void,
  ): Promise<ClientManifestGenerationResult>;

  extractAdapters(
    topology: ManifestTopologyDraft,
    signal?: AbortSignal,
    onStepDetail?: (detail: string) => void,
  ): Promise<ClientManifestGenerationAdaptersPhaseResult>;

  checkClarificationTriggers(
    topology: ManifestTopologyDraft,
  ): ClarificationTrigger[];

  renderManifest(
    draft: ManifestDraft,
    signal?: AbortSignal,
  ): Promise<{ yaml: string; diagnostics: DraftDiagnostic[] }>;
}

export interface ClientManifestGenerationDeps {
  messagingPort: {
    sendStructuredPrompt(
      userPrompt: string,
      systemPrompt: string,
      signal?: AbortSignal,
    ): Promise<string>;
  };
  contextListSchema: ZodSchema<ContextListEntry[]>;
  portsListSchema: ZodSchema<PortsList>;
  prompts: {
    contextListSystemPrompt: string;
    compileContextListPrompt: (input: { userDescription: string }) => string;
    portsListSystemPrompt: string;
    compilePortsPrompt: (
      contextName: string,
      contextDescription: string,
      contextType: string,
    ) => string;
    adapterSystemPrompt: string;
    compileAdapterUserPrompt: (input: {
      validatedPortInventory: string[];
      contextName: string;
      validationErrors?: string;
    }) => string;
  };
  normalizeDraft: (draft: ManifestDraft) => ManifestDraft;
  normalizeTopologyDraft: (
    topology: ManifestTopologyDraft,
  ) => ManifestTopologyDraft;
  validateDraft: (draft: ManifestDraft) => {
    ok: true;
    diagnostics: DraftDiagnostic[];
  };
  checkClarificationTriggers: (
    topology: ManifestTopologyDraft,
  ) => ClarificationTrigger[];
  draftToManifest: (draft: ManifestDraft) => ManifestDraft;
  renderDraft: (
    manifest: ManifestDraft,
    diagnostics: DraftDiagnostic[],
  ) => Promise<{ yaml: string; diagnostics: DraftDiagnostic[] }>;
  coerceRawPorts: (ports: unknown) => PortsList;
  coerceContextType: (type: string) => BoundedContextType;
  coercePort: (
    port: Record<string, unknown>,
    direction: "in" | "out",
  ) => { name: string; type: string; description: string };
  normalizePortName: (name: string) => string;
  parseJSON: <T>(
    content: string,
  ) => { ok: true; data: T } | { ok: false; error: string };
  extractArrayFromWrapper: <T>(data: unknown, wrapperKeys: string[]) => T[];
  extractObjectFromWrapper: <T>(
    data: unknown,
    wrapperKeys: string[],
  ) => T | null;
}
