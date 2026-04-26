import {
  type PromptTemplate,
  type RenderedPrompt,
  createPromptTemplate,
  renderPrompt,
} from "../../domain/prompt-template";
import type {
  PromptCompilerPort,
  PromptCompileRequest,
} from "../../application/ports/in/prompt-compiler.port";

const DEFAULT_SYSTEM_PROMPT = `You are a software architect assistant helping users design and implement hexagonal/monorepo architectures.
Analyze the user's intent and provide guidance on:
- Bounded context design
- Port/adapter separation
- Dependency flow (driven vs driving)
- Domain-driven design patterns`;

const DEFAULT_USER_PROMPT_TEMPLATE = `## Context
Project Manifest:
{{manifest}}

Architecture Graph:
{{architectureGraph}}

Linter Report:
{{linterReport}}

## User Intent
{{userIntent}}

## Task
{{task}}`;

export class DefaultPromptCompilerAdapter implements PromptCompilerPort {
  async compile(request: PromptCompileRequest): Promise<PromptTemplate> {
    const manifestStr = JSON.stringify(request.manifest, null, 2);
    const architectureGraphStr = JSON.stringify(
      request.architectureGraph,
      null,
      2,
    );
    const linterReportStr = JSON.stringify(request.linterReport, null, 2);

    const context = {
      manifest: request.manifest,
      architectureGraph: request.architectureGraph,
      linterReport: request.linterReport,
      userIntent: request.userIntent,
      lineage: [],
    };

    const template = createPromptTemplate(
      request.name,
      DEFAULT_SYSTEM_PROMPT,
      DEFAULT_USER_PROMPT_TEMPLATE,
      context,
      [
        {
          name: "manifest",
          description: "Serialized project manifest",
          defaultValue: manifestStr,
        },
        {
          name: "architectureGraph",
          description: "Serialized architecture graph",
          defaultValue: architectureGraphStr,
        },
        {
          name: "linterReport",
          description: "Linter compliance report",
          defaultValue: linterReportStr,
        },
        {
          name: "userIntent",
          description: "The user's intent",
          defaultValue: request.userIntent,
        },
        {
          name: "task",
          description: "The specific task to perform",
          defaultValue: request.userIntent,
        },
      ],
    );

    return template;
  }

  render(
    template: PromptTemplate,
    overrides?: Record<string, string>,
  ): RenderedPrompt {
    return renderPrompt(template, overrides);
  }
}
