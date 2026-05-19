export enum ManifestWarningCategory {
  MISSING_CONTEXTS = "missing-contexts",
  MISSING_PORTS = "missing-ports",
  MISSING_ADAPTERS = "missing-adapters",
}

export interface ManifestWarning {
  category: ManifestWarningCategory;
  context?: string;
  message: string;
  suggestedAction: "clarify" | "retry" | "manual-edit";
}

export interface GenerationDiagnostics {
  totalAttempts: number;
  tokensUsed: number;
  processingTime: number;
  repairApplied: boolean;
  model: string;
}

export interface GenerateManifestFromDescriptionRequest {
  description: import("../../domain/value-objects/index").ProjectDescription;
}

export interface GenerateManifestFromDescriptionResponse {
  success: boolean;
  manifest?: import("../../domain/value-objects/index").GeneratedManifest;
  error?: string;
  warnings?: ManifestWarning[];
  diagnostics?: GenerationDiagnostics;
}
