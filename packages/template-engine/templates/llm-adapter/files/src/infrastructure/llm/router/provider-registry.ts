import type { LLMClientPort } from "../../../domain/ports/out/llm-client.port";

/**
 * Provider-registration seam. Addon templates (e.g. `llm-adapter-bedrock`)
 * register an extra LLM provider here instead of overwriting the router or the
 * built-in `MODELS` map — keeping the base files untouched and the addon
 * self-contained.
 *
 * Each registration supplies a lazy adapter factory and the model id per call
 * tier, so `LLMRouter` can resolve a registered provider exactly like a built-in
 * one. Register at startup, before the router is constructed:
 *
 *   import "./infrastructure/llm/adapters/<provider>-register";
 */
export interface ProviderModels {
  readonly reasoning: string;
  readonly fast: string;
  readonly vision: string;
}

export interface ProviderRegistration {
  /** Lazily instantiate the adapter — only registered providers are built. */
  readonly factory: () => LLMClientPort;
  /** Model id per call tier (env-overridable in the addon's registration). */
  readonly models: ProviderModels;
}

const registry = new Map<string, ProviderRegistration>();

export function registerProvider(
  name: string,
  registration: ProviderRegistration,
): void {
  // Reject duplicates so a typo or a second addon can't silently replace an
  // already-registered provider and change routing with no signal.
  if (registry.has(name)) {
    throw new Error(`LLM provider "${name}" is already registered.`);
  }
  registry.set(name, registration);
}

/** Snapshot of registered providers, consumed by `LLMRouter`'s constructor. */
export function registeredProviders(): ReadonlyMap<string, ProviderRegistration> {
  return registry;
}
