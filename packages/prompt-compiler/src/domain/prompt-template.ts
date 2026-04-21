export type Identifier = string;

export interface DomainASTLike {
  nodes: unknown[];
  edges: unknown[];
  invariants: {
    topology: unknown[];
    cardinality: unknown[];
  };
}

export interface PromptVariable {
  name: string;
  description: string;
  defaultValue?: string;
}

export interface PromptContext {
  domainAST: DomainASTLike;
  userIntent: string;
  governanceRules: string[];
  lineage: Identifier[];
}

export interface PromptTemplate {
  id: Identifier;
  name: string;
  systemPrompt: string;
  userPromptTemplate: string;
  variables: PromptVariable[];
  context: PromptContext;
  version: number;
}

export interface RenderedPrompt {
  systemPrompt: string;
  userPrompt: string;
  variables: Record<string, string>;
}

export function createPromptTemplate(
  name: string,
  systemPrompt: string,
  userPromptTemplate: string,
  context: PromptContext,
  variables: PromptVariable[] = [],
): PromptTemplate {
  return {
    id: `prompt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    name,
    systemPrompt,
    userPromptTemplate,
    variables,
    context,
    version: 1,
  };
}

export function renderPrompt(
  template: PromptTemplate,
  overrides: Record<string, string> = {},
): RenderedPrompt {
  const variableValues: Record<string, string> = {};

  for (const variable of template.variables) {
    variableValues[variable.name] =
      overrides[variable.name] ?? variable.defaultValue ?? "";
  }

  let userPrompt = template.userPromptTemplate;
  for (const [name, value] of Object.entries(variableValues)) {
    userPrompt = userPrompt.replace(new RegExp(`{{${name}}}`, "g"), value);
  }

  return {
    systemPrompt: template.systemPrompt,
    userPrompt,
    variables: variableValues,
  };
}
