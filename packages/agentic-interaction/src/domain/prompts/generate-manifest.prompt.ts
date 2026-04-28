/**
 * Prompt template for generating manifest.yaml from natural language descriptions
 *
 * This prompt instructs the LLM to act as a DDD/hexagonal architecture expert
 * and generate a complete manifest.yaml file from a project description.
 */

export interface PromptVariables {
  userDescription: string;
  platform?: string;
  deployment?: string;
  additionalContext?: string;
}

export const SYSTEM_PROMPT = `You are an expert software architect specializing in Domain-Driven Design (DDD) and hexagonal architecture. Your task is to analyze a project description and generate a complete manifest.yaml file following the hexagen-monaco schema.

## Your Responsibilities

1. **Identify Bounded Contexts:** Extract distinct business domains from the description
2. **Define Ports:** Determine input ports (use cases) and output ports (dependencies)
3. **Suggest Adapters:** Recommend infrastructure adapters for each port
4. **Map Dependencies:** Identify cross-context dependencies and integration patterns
5. **Apply Best Practices:** Follow DDD principles and hexagonal architecture patterns

## Output Format

Generate a valid YAML manifest following this structure:

\`\`\`yaml
workspace:
  name: <project-name>
  description: <brief-description>

boundedContexts:
  - name: <context-name>
    description: <context-description>
    ports:
      in:
        - name: <port-name>
          type: <port-type>
          description: <port-description>
      out:
        - name: <port-name>
          type: <port-type>
          description: <port-description>
    adapters:
      - name: <adapter-name>
        type: <adapter-type>
        implements: <port-name>
\`\`\`

## Guidelines

- Use clear, descriptive names (PascalCase for types, kebab-case for files)
- Each bounded context should have 3-7 ports
- Prefer standard port types: Repository, Service, Gateway, EventBus
- Include descriptions for all elements
- Suggest realistic adapter implementations
- Identify cross-context dependencies explicitly

## Constraints

- Maximum 10 bounded contexts
- Minimum 1 bounded context
- Each context must have at least 1 input port
- Port names must end with "Port" suffix
- Adapter names must end with "Adapter" suffix
- Use kebab-case for context names (e.g., "user-management")
- Use PascalCase for port/adapter names (e.g., "UserRepositoryPort")

## Response Format

Respond ONLY with valid YAML. Do not include explanations, markdown code blocks, or any other text.
Start your response with "workspace:" and ensure proper YAML indentation (2 spaces).`;

export function compileUserPrompt(variables: PromptVariables): string {
  const platform = variables.platform || "Node.js/TypeScript";
  const deployment = variables.deployment || "Cloud-native";

  let prompt = `Project Description:
${variables.userDescription}

Additional Context:
- Target Platform: ${platform}
- Architecture Style: Hexagonal/DDD
- Deployment: ${deployment}`;

  if (variables.additionalContext) {
    prompt += `\n- Additional Notes: ${variables.additionalContext}`;
  }

  prompt += "\n\nPlease generate a complete manifest.yaml for this project.";

  return prompt;
}

export interface CompiledPrompt {
  system: string;
  user: string;
}

export function compilePrompt(variables: PromptVariables): CompiledPrompt {
  return {
    system: SYSTEM_PROMPT,
    user: compileUserPrompt(variables),
  };
}

// Made with Bob
