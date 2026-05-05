export interface NormalizedPrompt {
  intent: string;
  explicitTechnologies: string[];
  explicitPatterns: string[];
  ambiguities: string[];
}

export interface DomainAnalysis {
  verbs: string[];
  nouns: string[];
  subdomains: string[];
}

export interface ClassifiedContext {
  name: string;
  type: "core" | "supporting" | "generic" | "shared-kernel";
  reasoning: string;
}

export interface RejectedContext {
  name: string;
  reasoning: string;
}

export interface UncertainContext {
  name: string;
  reasoning: string;
}

export interface ClassificationResult {
  accepted: ClassifiedContext[];
  rejected: RejectedContext[];
  uncertain: UncertainContext[];
}

export type InboundPortType = "command" | "query" | "event";
export type OutboundPortType = "repository" | "publisher" | "external-client" | "notifier";

export interface PortDefinition {
  name: string;
  type: InboundPortType | OutboundPortType;
  description: string;
}

export interface ContextPorts {
  contextName: string;
  in: PortDefinition[];
  out: PortDefinition[];
}

export interface PortMap {
  contexts: ContextPorts[];
}

export interface AdapterBinding {
  name: string;
  type: string;
  implements: string;
}

export interface ContextAdapters {
  contextName: string;
  adapters: AdapterBinding[];
}

export interface AdapterBindings {
  contexts: ContextAdapters[];
}

export interface AssembledManifest {
  yaml: string;
  parsedObject: Record<string, unknown>;
}

export interface ValidationReport {
  warnings: string[];
  errors: string[];
  passed: boolean;
}

export interface PipelineState {
  stage0?: NormalizedPrompt;
  stage1?: DomainAnalysis;
  stage2?: ClassificationResult;
  stage3?: PortMap;
  stage4?: AdapterBindings;
  stage5?: AssembledManifest;
  stage6?: ValidationReport;
}
