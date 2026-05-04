import type { z } from "zod";
import type {
  ManifestDraftSchema,
  ManifestTopologyDraftSchema,
  ManifestDraftContextSchema,
  ManifestDraftPortSchema,
  ManifestDraftAdapterSchema,
  ManifestTopologyDraftContextSchema,
  ContextListSchema,
  PortsListSchema,
  PortsListEntrySchema,
} from "./manifest-draft.schema.js";

export type ManifestDraft = z.infer<typeof ManifestDraftSchema>;
export type ManifestTopologyDraft = z.infer<typeof ManifestTopologyDraftSchema>;
export type ContextListEntry = z.infer<typeof ContextListSchema>[number];
export type PortsList = z.infer<typeof PortsListSchema>;
export type PortsListEntry = z.infer<typeof PortsListEntrySchema>;
export type ManifestDraftContext = z.infer<typeof ManifestDraftContextSchema>;
export type ManifestDraftPort = z.infer<typeof ManifestDraftPortSchema>;
export type ManifestDraftAdapter = z.infer<typeof ManifestDraftAdapterSchema>;
export type ManifestTopologyDraftContext = z.infer<
  typeof ManifestTopologyDraftContextSchema
>;

export interface DraftDiagnostic {
  code: string;
  message: string;
  path?: string;
}

export interface DraftValidationResult {
  valid: boolean;
  diagnostics: DraftDiagnostic[];
}

export interface ClarificationTrigger {
  type:
    | "no-inbound-ports"
    | "single-context-no-outbound"
    | "generic-context-name";
  contextName?: string;
  message: string;
}

export interface RenderedManifest {
  yaml: string;
  diagnostics: DraftDiagnostic[];
  token: string;
}
