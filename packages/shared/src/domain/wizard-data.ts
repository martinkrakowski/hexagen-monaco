/** DDD relationship types used to classify cross-context dependencies. */
export type ContextRelationshipType = "U" | "D" | "ACL" | "SK" | "P" | "OHS";

/**
 * Represents a peer Bounded Context in the strategic landscape.
 * Rendered in the outer orbit ring, distinct from infrastructure adapters.
 */
export interface ExternalContext {
  id: string;
  name: string;
  relationshipType: ContextRelationshipType;
  isEventDriven?: boolean;
  entityNames?: string[];
  useCaseNames?: string[];
}

/**
 * WizardData is the input port between the project wizard (controller layer)
 * and the canvas visualization use case. It represents the in-progress state
 * of the wizard at any step — all fields are optional because the diagram
 * renders incrementally as the user fills each step.
 */
export interface WizardData {
  /** Step 1: triggers the central bounded-context node */
  rootName?: string;
  /** Step 6: domain entities → inner ring */
  entities?: string[];
  /** Step 6: domain use-cases → inner ring */
  useCases?: string[];
  /** Step 4: inbound API driver → outer ring */
  apiFramework?: string;
  /** Step 4: inbound UI driver → outer ring */
  uiFramework?: string;
  /** Step 5: outbound persistence adapter → outer ring */
  persistenceAdapter?: string;
  /** Step 5: outbound messaging adapter → outer ring */
  messagingAdapter?: string;
  /** Step 5: telemetry provider → outer ring (value "None" is filtered out) */
  telemetryProvider?: string;
  /** Step 3: external API ports → outer ring */
  externalApiPorts?: string[];
  /** Step 1 addon (withLlm): LLM provider ports → outer ring */
  llmProviders?: string[];
  /** Step 1 addon (withBlockchain): blockchain network ports → outer ring */
  blockchainNetworks?: string[];
  /** West/External side: outbound auth provider (Auth0, Cognito, etc.) */
  authenticationProvider?: string;
  /** West/External side: outbound transactional email service */
  emailService?: string;
  /** West/External side: outbound payment gateway */
  paymentGateway?: string;
  /** West/External side: outbound object storage provider */
  storageProvider?: string;
  /** West/External side: outbound search service */
  searchService?: string;
  /** North/Presentation side: inbound webhook/callback endpoint names */
  webhookEndpoints?: string[];
  /** Strategic landscape: peer Bounded Contexts in the outer orbit ring */
  externalContexts?: ExternalContext[];
}
