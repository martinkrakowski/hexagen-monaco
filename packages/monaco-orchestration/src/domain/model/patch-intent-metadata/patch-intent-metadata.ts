export interface PatchIntentMetadata {
  source: 'agent' | 'user' | 'system';
  requiresConfirmation: boolean;
  rationale: string;
}
