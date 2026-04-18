/**
 * Governance assistant Q&A pair value object — persisted conversation entry.
 * Tracks the user's question label and the AI's response within a governance context.
 */
export interface GovernanceEntry {
  id: string;
  questionLabel: string;
  answer: string;
}
