import type { UserSecretVaultPort } from "@hexagen/web-driver";

/**
 * Props for the CloudModelSettingsView component
 */
export interface CloudModelSettingsViewProps {
  vault: UserSecretVaultPort;
  onConnect: (provider: string, model: string) => Promise<void>;
  isConnecting?: boolean;
  connectionError?: string | null;
  onRetry?: () => void;
  onCancelConnection?: () => void;
}

/**
 * Cloud model settings data shape
 */
export interface CloudSettings {
  email: string;
  apiKey: string;
  modelId: string;
  providerId: string;
  temperature: number;
  maxTokens: number;
}

/**
 * Cloud connection state
 */
export interface CloudConnectionState {
  connected: boolean;
  loading: boolean;
  error?: string;
}

/**
 * Validation errors for form fields
 */
export interface ValidationErrors {
  email?: string;
  apiKey?: string;
  model?: string;
  provider?: string;
}

/**
 * UI state discriminated union for handling different states
 */
export type CloudSettingsUIState =
  | { type: "idle" }
  | { type: "editing"; isDirty: boolean }
  | { type: "connecting"; provider: string; model: string }
  | { type: "error"; message: string }
  | { type: "success"; message: string };

/**
 * Client provider definition
 */
export interface ClientProvider {
  id: string;
  displayName: string;
  available: boolean;
  models: ClientModel[];
}

/**
 * Client model definition
 */
export interface ClientModel {
  id: string;
  displayName: string;
  available: boolean;
}
