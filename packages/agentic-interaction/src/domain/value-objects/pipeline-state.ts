export interface NormalizedPrompt {
  intent: string;
  explicitTechnologies: string[];
  explicitPatterns: string[];
  ambiguities: string[];
  projectName?: string;
  isStructuredConfig?: boolean;
}

export interface AggregateRoot {
  name: string;
  subdomain: string;
  identityFields?: string[];
}

export interface DomainEntity {
  name: string;
  parentAggregate: string;
}

export interface DomainValueObject {
  name: string;
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
  type: "core" | "supporting" | "generic" | "shared-kernel";
  reasoning: string;
  responsibility?: string;
  aggregateRoots?: string[];
  useCaseNames?: string[];
  eventsPublished?: string[];
  promotedFromUncertain?: boolean;
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
