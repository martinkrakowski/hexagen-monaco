import type { BoundedContextType } from "@hexagen/shared";

export interface NormalizedPrompt {
  intent: string;
  explicitTechnologies: string[];
  explicitPatterns: string[];
  ambiguities: string[];
  projectName?: string;
  isStructuredConfig?: boolean;
  runtimeConcerns?: string[];
}

export interface AggregateRoot {
  name: string;
  subdomain: string;
  identityFields?: string[];
}

export interface DomainEntity {
  name: string;
  subdomain?: string;
  parentAggregate: string;
}

export interface DomainValueObject {
  name: string;
  subdomain?: string;
  rules?: string;
}

export interface DomainEvent {
  name: string;
  emitter: string;
  trigger?: string;
}

export interface DomainAnalysis {
  verbs: string[];
  nouns: string[];
  subdomains: string[];
  aggregateRoots?: AggregateRoot[];
  entities?: DomainEntity[];
  valueObjects?: DomainValueObject[];
  domainEvents?: DomainEvent[];
  useCases?: Array<{
    name: string;
    subdomain: string;
    actor?: string;
    commandName?: string;
  }>;
}

export interface ClassifiedContext {
  name: string;
  type: BoundedContextType;
  reasoning: string;
  responsibility?: string;
  aggregateRoots?: string[];
  useCaseNames?: string[];
  eventsPublished?: string[];
  promotedFromUncertain?: boolean;
  needsTypeReview?: boolean;
}

export type AcceptedContext = ClassifiedContext;

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
export type OutboundPortType =
  | "repository"
  | "publisher"
  | "external-client"
  | "notifier";

export interface PortDefinition {
  name: string;
  type: InboundPortType | OutboundPortType;
  description: string;
  forAggregate?: string;
  justification?: string;
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
  adapterType?:
    | "Repository"
    | "Listener"
    | "Publisher"
    | "HttpClient"
    | "Notifier"
    | "Controller";
  technology?: string;
}

export interface ContextAdapters {
  contextName: string;
  adapters: AdapterBinding[];
}

export interface AdapterBindings {
  contexts: ContextAdapters[];
}

export interface AssemblyWarning {
  contextName: string;
  message: string;
  severity: "warning" | "info";
}

export interface AssembledManifest {
  yaml: string;
  parsedObject: Record<string, unknown>;
  assemblyWarnings?: AssemblyWarning[];
  /**
   * Drops/coercions the Stage-5 schema gate made so the rendered manifest
   * parses under the accept screen's strict ManifestSchema (see
   * enforce-manifest-schema.ts). Surfaced by orchestrators as adjustments.
   */
  schemaAdvisories?: string[];
  /**
   * Schema issues that survived the gate's sanitization (`path: message`).
   * Should be empty; non-empty means the accept screen will reject the
   * manifest, so orchestrators surface these as errors.
   */
  schemaIssues?: string[];
}

export interface ValidationReport {
  warnings: string[];
  errors: string[];
  passed: boolean;
}

export interface ContextMappingEntry {
  upstream: string;
  downstream: string;
  pattern?: string;
  mechanism?: string;
  notes?: string;
  events?: string[];
}

export interface PipelineState {
  stage0?: NormalizedPrompt;
  stage1?: DomainAnalysis;
  stage2?: ClassificationResult;
  stage3?: PortMap;
  stage4?: AdapterBindings;
  stage5?: AssembledManifest;
  stage6?: ValidationReport;
  contextMappings?: ContextMappingEntry[];
}
