export interface PortEntry {
  name: string;
  hasIssue: boolean;
  issueMessage?: string;
}

export interface AdapterEntry {
  name: string;
  implements?: string;
  hasIssue: boolean;
  issueMessage?: string;
}

export interface BoundedContextView {
  name: string;
  // The full canonical context-type vocabulary. `shared-kernel` and `generic`
  // are real manifest types (DDD context taxonomy) — earlier this union omitted
  // them, so the parser coerced both to "supporting", mislabeling cards and the
  // AI grounding. See manifest-view-data-parser.
  type: "core" | "supporting" | "generic" | "shared-kernel" | "driver";
  description: string;
  colorToken: string;
  portsIn: PortEntry[];
  portsOut: PortEntry[];
  adapters: AdapterEntry[];
  health: "healthy" | "warning" | "error";
  healthReasons: string[];
  yamlLineRange: { start: number; end: number };
}

export interface ManifestViewData {
  system: string;
  scope: string;
  architecture: string;
  contexts: BoundedContextView[];
  validationItems: ValidationItem[];
  overallScore: number;
}

export interface ValidationItem {
  status: "pass" | "warn" | "fail";
  title: string;
  description: string;
  contextName?: string;
}
