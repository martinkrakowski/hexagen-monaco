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
}
