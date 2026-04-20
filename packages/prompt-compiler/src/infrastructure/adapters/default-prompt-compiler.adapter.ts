import type { DomainAST, Identifier } from "@hexagen/core-domain";
import {
  type PromptTemplate,
  type RenderedPrompt,
  createPromptTemplate,
  renderPrompt,
} from "../../domain/prompt-template.js";
import type { PromptCompilerPort } from "../../application/ports/in/prompt-compiler.port.js";

const DEFAULT_SYSTEM_PROMPT = `You are a software architect assistant helping users design and implement hexagonal/monorepo architectures.
Analyze the user's intent and provide guidance on:
- Bounded context design
- Port/adapter separation
- Dependency flow (driven vs driving)
- Domain-driven design patterns`;

const DEFAULT_USER_PROMPT_TEMPLATE = `## Context
Domain AST:
{{domainAST}}

## User Intent
{{userIntent}}

## Governance Rules
{{governanceRules}}

## Task
{{task}}`;

export class DefaultPromptCompilerAdapter implements PromptCompilerPort {
  async compile(request: {
    name: string;
    domainAST: DomainAST;
    userIntent: string;
    governanceRules: string[];
    templateOverrides?: Record<string, string>;
  }): Promise<PromptTemplate> {
    const domainASTStr = JSON.stringify(request.domainAST, null, 2);
    const governanceRulesStr = request.governanceRules.join("\n- ");

    const context = {
      domainAST: request.domainAST,
      userIntent: request.userIntent,
      governanceRules: request.governanceRules,
      lineage: [],
    };

    const template = createPromptTemplate(
      request.name,
      DEFAULT_SYSTEM_PROMPT,
      DEFAULT_USER_PROMPT_TEMPLATE,
      context,
      [
        { name: "domainAST", description: "Serialized Domain AST", defaultValue: domainASTStr },
        { name: "userIntent", description: "The user's intent", defaultValue: request.userIntent },
        { name: "governanceRules", description: "Governance rules to follow", defaultValue: governanceRulesStr },
        { name: "task", description: "The specific task to perform", defaultValue: request.userIntent },
      ],
    );

    return template;
  }

  render(template: PromptTemplate, overrides?: Record<string, string>): RenderedPrompt {
    return renderPrompt(template, overrides);
  }
}