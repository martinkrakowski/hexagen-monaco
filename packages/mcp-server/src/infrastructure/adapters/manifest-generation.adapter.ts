import type {
  ManifestGenerationPort,
  TopologyGenerationRequest,
  TopologyGenerationResponse,
  AdapterGenerationRequest,
  AdapterGenerationResponse,
  PipelineGenerationRequest,
  PipelineGenerationResponse,
} from "../../application/ports/out/manifest-generation.port.js";
import type { ManifestWritePort } from "../../application/ports/out/manifest-write.port.js";
import type { EventBusPort } from "@hexagen/messaging";
import type { BoundedContextType } from "@hexagen/shared";
import {
  ManifestTopologyDraftSchema,
  normalizeDraft,
  normalizeTopologyDraft,
  validateDraft,
  draftToManifest,
  renderManifestYaml,
  parseJSON,
  checkClarificationTriggers,
  compileTopologyUserPrompt,
  TOPOLOGY_SYSTEM_PROMPT,
  compileAdapterUserPrompt,
  ADAPTER_SYSTEM_PROMPT,
  type ManifestTopologyDraft,
  type ManifestDraft,
} from "@hexagen/agentic-interaction";

interface LLMApiConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

async function callLLM(
  config: LLMApiConfig,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  const model = config.model ?? "gpt-4o";

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
    }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices?.[0]?.message?.content ?? "";
}

export class OpenAIManifestGenerationAdapter implements ManifestGenerationPort {
  constructor(
    private readonly config: LLMApiConfig,
    private readonly manifestWritePort?: ManifestWritePort,
    private readonly eventBusPort?: EventBusPort,
  ) {}

  async generateTopology(
    request: TopologyGenerationRequest,
    signal?: AbortSignal,
  ): Promise<TopologyGenerationResponse> {
    const maxRetries = request.maxRetries ?? 2;
    let lastError = "";

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) throw new Error("Request aborted");

      const userPrompt = compileTopologyUserPrompt({
        userDescription: request.description,
        validationErrors: attempt > 0 ? lastError : undefined,
      });

      const content = await callLLM(
        this.config,
        TOPOLOGY_SYSTEM_PROMPT,
        userPrompt,
        signal,
      );

      const parsed = parseJSON<ManifestTopologyDraft>(content);
      if (!parsed.ok) {
        lastError = parsed.error;
        if (attempt === maxRetries) throw new Error(lastError);
        continue;
      }

      const result = ManifestTopologyDraftSchema.safeParse(parsed.data);
      if (!result.success) {
        lastError = result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        if (attempt === maxRetries)
          throw new Error(`Schema validation: ${lastError}`);
        continue;
      }

      const topology = normalizeTopologyDraft(result.data);
      const clarificationTriggers = checkClarificationTriggers(topology);

      return {
        topology: topology as unknown as TopologyGenerationResponse["topology"],
        clarificationTriggers:
          clarificationTriggers as unknown as TopologyGenerationResponse["clarificationTriggers"],
      };
    }

    throw new Error("Failed to generate topology after retries");
  }

  async generateAdapters(
    request: AdapterGenerationRequest,
    signal?: AbortSignal,
  ): Promise<AdapterGenerationResponse> {
    const maxRetries = request.maxRetries ?? 2;
    let lastError = "";

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) throw new Error("Request aborted");

      const userPrompt = compileAdapterUserPrompt({
        validatedPortInventory: request.portNames,
        contextName: request.contextName,
        validationErrors: attempt > 0 ? lastError : undefined,
      });

      const content = await callLLM(
        this.config,
        ADAPTER_SYSTEM_PROMPT,
        userPrompt,
        signal,
      );

      type AdapterArray = ManifestDraft["boundedContexts"][number]["adapters"];
      const parsed = parseJSON<AdapterArray>(content);
      if (!parsed.ok) {
        lastError = parsed.error;
        if (attempt === maxRetries) throw new Error(lastError);
        continue;
      }

      const adapters = parsed.data;
      const invalidImplements = adapters.filter(
        (a) => !request.portNames.includes(a.implements),
      );
      if (invalidImplements.length > 0) {
        lastError = `Invalid "implements" values: ${invalidImplements.map((a) => a.implements).join(", ")}. Must be one of: ${request.portNames.join(", ")}`;
        if (attempt === maxRetries) throw new Error(lastError);
        continue;
      }

      return {
        adapters: adapters as unknown as AdapterGenerationResponse["adapters"],
      };
    }

    throw new Error("Failed to generate adapters after retries");
  }

  async generateManifestPipeline(
    request: PipelineGenerationRequest,
  ): Promise<PipelineGenerationResponse> {
    const topologyResult = await this.generateTopology(
      {
        description: request.description,
        maxRetries: request.maxRetries,
      },
      request.signal,
    );

    const draft = await this.enrichWithAdapters(
      topologyResult,
      request.maxRetries,
      request.signal,
    );

    const normalized = normalizeDraft(draft);
    const validation = validateDraft(normalized);
    const manifest = draftToManifest(normalized);
    const yaml = renderManifestYaml(manifest);

    const totalPorts = normalized.boundedContexts.reduce(
      (sum, ctx) => sum + ctx.ports.in.length + ctx.ports.out.length,
      0,
    );
    const totalAdapters = normalized.boundedContexts.reduce(
      (sum, ctx) => sum + ctx.adapters.length,
      0,
    );

    const diagnostics = validation.diagnostics.map((d) => ({
      code: d.code,
      message: d.message,
      path: d.path,
    }));

    if (request.dryRun ?? false) {
      return {
        dryRun: true,
        yaml,
        contextCount: normalized.boundedContexts.length,
        totalPorts,
        totalAdapters,
        diagnostics,
        registeredInManifest: false,
      };
    }

    // GOVERNANCE GATE — validation must gate the write, not just annotate it.
    // With diagnostics present the generated draft failed structural
    // validation; registering its contexts anyway would put an invalid
    // architecture into the manifest with the diagnostics as a footnote.
    // The YAML + diagnostics are still returned so the caller can repair
    // the draft and re-run (or use dryRun to iterate).
    if (diagnostics.length > 0) {
      return {
        dryRun: false,
        yaml,
        contextCount: normalized.boundedContexts.length,
        totalPorts,
        totalAdapters,
        diagnostics,
        registeredInManifest: false,
      };
    }

    let allRegistered = false;
    if (this.manifestWritePort) {
      const registerResults = await Promise.all(
        normalized.boundedContexts.map((ctx) =>
          this.manifestWritePort!.registerBoundedContext({
            name: ctx.name,
            type: ctx.type as BoundedContextType | undefined,
          }),
        ),
      );
      allRegistered = registerResults.every((r) => r.success);
    }

    if (this.eventBusPort) {
      this.eventBusPort.publish({
        type: "ManifestGenerated",
        payload: {
          description: request.description,
          contextCount: normalized.boundedContexts.length,
          totalPorts,
          totalAdapters,
        },
        timestamp: Date.now(),
        source: "mcp-server",
      });
    }

    return {
      dryRun: false,
      yaml,
      contextCount: normalized.boundedContexts.length,
      totalPorts,
      totalAdapters,
      diagnostics,
      registeredInManifest: allRegistered,
    };
  }

  private async enrichWithAdapters(
    topologyResult: TopologyGenerationResponse,
    maxRetries?: number,
    signal?: AbortSignal,
  ): Promise<ManifestDraft> {
    const draftContexts: ManifestDraft["boundedContexts"] = [];

    for (const ctx of topologyResult.topology.boundedContexts) {
      const allPortNames = [
        ...ctx.ports.in.map((p: { name: string }) => p.name),
        ...ctx.ports.out.map((p: { name: string }) => p.name),
      ];

      let adapters: ManifestDraft["boundedContexts"][number]["adapters"] = [];

      if (allPortNames.length > 0) {
        try {
          const result = await this.generateAdapters(
            {
              contextName: ctx.name,
              portNames: allPortNames,
              maxRetries,
            },
            signal,
          );
          adapters =
            result.adapters as unknown as ManifestDraft["boundedContexts"][number]["adapters"];
        } catch {
          adapters = [];
        }
      }

      draftContexts.push({
        name: ctx.name,
        type: ctx.type,
        description: ctx.description,
        ports:
          ctx.ports as unknown as ManifestDraft["boundedContexts"][number]["ports"],
        adapters,
        dependsOn: ctx.dependsOn,
      });
    }

    return {
      workspace: topologyResult.topology.workspace,
      boundedContexts: draftContexts,
    };
  }
}
