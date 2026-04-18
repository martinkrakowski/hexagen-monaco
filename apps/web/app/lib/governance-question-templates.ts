export interface Violation {
  id: string;
  type: "error" | "warning" | "info";
  message: string;
  context?: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
}

export interface AISuggestion {
  id: string;
  message: string;
  confidence: number;
  category:
    | "context-split"
    | "port-definition"
    | "dependency-cleanup"
    | "general";
}

export type QuestionType =
  | "explain"
  | "fix"
  | "example"
  | "impact"
  | "alternatives"
  | "implement"
  | "tradeoffs"
  | "guidance";

export interface PrebakedQuestion {
  id: string;
  type: QuestionType;
  label: string;
}

export const VIOLATION_QUESTIONS: PrebakedQuestion[] = [
  { id: "explain", type: "explain", label: "What does this mean?" },
  { id: "fix", type: "fix", label: "What should I change?" },
  { id: "example", type: "example", label: "Show me the pattern" },
  { id: "impact", type: "impact", label: "What happens if I ignore it?" },
];

export const SUGGESTION_QUESTIONS: PrebakedQuestion[] = [
  { id: "explain", type: "explain", label: "Why this recommendation?" },
  { id: "implement", type: "implement", label: "How do I apply it?" },
  { id: "tradeoffs", type: "tradeoffs", label: "What are the tradeoffs?" },
];

export type WizardStepId =
  | "workspace_governance"
  | "bounded_contexts"
  | "peer_mappings"
  | "ports_configuration"
  | "github_export"
  | "summary";

export const FOLLOW_UP_INSTRUCTION = `\n\nFollow-up Questions Requirement:
After your answer, output a JSON array of 3-5 follow-up question objects in this exact format (no other text after it):
[{"type":"guidance","label":"question text here"},{"type":"guidance","label":"another question"}]
All follow-up question labels must be in English.
Output the raw JSON array directly. Do not wrap it in code fences, backticks, or markdown formatting. Do not include any commentary after the JSON array.`;

export const STEP_QUESTIONS: Record<WizardStepId, PrebakedQuestion[]> = {
  workspace_governance: [
    { id: "topology", type: "guidance", label: "Strict vs flexible topology?" },
    {
      id: "template",
      type: "guidance",
      label: "How to pick a workspace template?",
    },
    {
      id: "namespace",
      type: "guidance",
      label: "What's a namespace prefix for?",
    },
  ],
  bounded_contexts: [
    {
      id: "naming",
      type: "guidance",
      label: "What makes a good context name?",
    },
    {
      id: "entities",
      type: "guidance",
      label: "How do I find my domain entities?",
    },
    { id: "split", type: "guidance", label: "When should I split a context?" },
  ],
  peer_mappings: [
    {
      id: "updown",
      type: "guidance",
      label: "Upstream vs downstream — which am I?",
    },
    { id: "acl", type: "guidance", label: "When do I need an ACL?" },
    { id: "oHS", type: "guidance", label: "OHS vs Partnership?" },
  ],
  ports_configuration: [
    { id: "rest", type: "guidance", label: "REST vs event listener — when?" },
    { id: "driven", type: "guidance", label: "What's a driven port?" },
    { id: "count", type: "guidance", label: "How many outbound ports?" },
  ],
  github_export: [
    { id: "what", type: "guidance", label: "What gets exported?" },
    { id: "structure", type: "guidance", label: "Monorepo vs polyrepo?" },
  ],
  summary: [
    { id: "sound", type: "guidance", label: "Is my architecture sound?" },
    { id: "risks", type: "guidance", label: "What could go wrong?" },
    { id: "evolve", type: "guidance", label: "How do I evolve this?" },
  ],
};

export function buildViolationPrompt(
  question: PrebakedQuestion,
  violation: Violation,
  wizardContext: string,
): string {
  const violationContext = `
Violation:
- Rule: ${violation.message}
- Severity: ${violation.severity}
${violation.context ? `- Context: ${violation.context}` : ""}
`.trim();

  switch (question.type) {
    case "explain":
      return `You are a Hexagonal Architecture expert. Explain this violation in 2-3 sentences to help a user understand what went wrong.

${violationContext}

WIZARD CONTEXT:
${wizardContext}

Your response should be concise and beginner-friendly.`;

    case "fix":
      return `You are a Hexagonal Architecture expert helping a user fix a governance violation.

${violationContext}

WIZARD CONTEXT:
${wizardContext}

Suggest 1-2 specific changes the user can make in the wizard to resolve this violation. Be actionable and specific.`;

    case "example":
      return `You are showing a correct implementation pattern for this rule.

${violationContext}

WIZARD CONTEXT:
${wizardContext}

Show a brief TypeScript code example of the CORRECT pattern. Keep it to 5-10 lines.`;

    case "impact":
      return `You are explaining the consequences of ignoring this architectural rule.

${violationContext}

WIZARD CONTEXT:
${wizardContext}

Explain in 2 sentences why this violation matters and what could go wrong if left unresolved.`;

    default:
      return `You are a Hexagonal Architecture expert.

${violationContext}

WIZARD CONTEXT:
${wizardContext}

Answer the user's question helpfully.`;
  }
}

export function buildSuggestionPrompt(
  question: PrebakedQuestion,
  suggestion: AISuggestion,
  wizardContext: string,
): string {
  const suggestionContext = `
Suggestion:
- Message: ${suggestion.message}
- Category: ${suggestion.category}
- Confidence: ${Math.round(suggestion.confidence * 100)}%
`.trim();

  switch (question.type) {
    case "explain":
      return `You are a Hexagonal Architecture expert. Explain why this suggestion makes sense.

${suggestionContext}

WIZARD CONTEXT:
${wizardContext}

Explain in 2-3 sentences the architectural reasoning behind this recommendation.`;

    case "implement":
      return `You are helping a user implement this architectural suggestion.

${suggestionContext}

WIZARD CONTEXT:
${wizardContext}

Explain which wizard fields or steps the user should change to implement this suggestion. Be specific and actionable.`;

    case "tradeoffs":
      return `You are analyzing the tradeoffs of this architectural recommendation.

${suggestionContext}

WIZARD CONTEXT:
${wizardContext}

List the benefits and potential drawbacks in a brief, balanced way (2-3 bullet points).`;

    default:
      return `You are a Hexagonal Architecture expert.

${suggestionContext}

WIZARD CONTEXT:
${wizardContext}

Answer the user's question helpfully.`;
  }
}

export function buildStepPrompt(
  question: PrebakedQuestion,
  stepId: WizardStepId,
  wizardContext: string,
): string {
  const stepContext = `
Current Wizard Step: ${stepId}
`.trim();

  return `You are a Hexagonal Architecture expert helping a user with their project wizard.

${stepContext}

WIZARD CONTEXT:
${wizardContext}

Answer the user's question: "${question.label}"

Be concise and beginner-friendly, 2-4 sentences max.`;
}

export function buildFollowUpPrompt(
  questionLabel: string,
  previousAnswer: string,
  wizardContext: string,
): string {
  return `You are a Hexagonal Architecture expert.

PREVIOUS CONVERSATION:
User: ${questionLabel}
Assistant: ${previousAnswer}

WIZARD CONTEXT:
${wizardContext}

Answer the user's follow-up question helpfully.`;
}
