import { ok, err } from "@hexagen/shared";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/shared";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/shared";
import { z } from "zod";
import {
  STAGE3_PORTS_SYSTEM_PROMPT,
  compileStage3Prompt,
} from "../../../domain/index.js";
import type {
  PortMap,
  PipelineState,
  ContextPorts,
  PortDefinition,
  InboundPortType,
  OutboundPortType,
} from "../../../domain/value-objects/pipeline-state.js";

const VALID_INBOUND_TYPES = new Set<string>(["command", "query", "event"]);
const VALID_OUTBOUND_TYPES = new Set<string>([
  "repository",
  "publisher",
  "external-client",
  "notifier",
]);

function coercePortType(
  direction: string,
  raw: string,
): InboundPortType | OutboundPortType | null {
  if (direction === "in") {
    return VALID_INBOUND_TYPES.has(raw) ? (raw as InboundPortType) : "command";
  }
  if (direction === "out") {
    return VALID_OUTBOUND_TYPES.has(raw)
      ? (raw as OutboundPortType)
      : "repository";
  }
  return null;
}

export class ExecutePortMappingUseCase {
  constructor(private readonly llmPort: SendStructuredRequestPort) {}

  async execute(
    state: Pick<PipelineState, "stage2">,
    onChunk?: (chunk: string) => void,
  ): Promise<
    { success: true; value: PortMap } | { success: false; error: unknown }
  > {
    const prompt = compileStage3Prompt(state);

    const request = createLLMRequest(
      DomainModelId.QWEN_CODER_3B,
      [
        { role: "system", content: STAGE3_PORTS_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      z.string(),
      { stream: true, temperature: 0.1, maxTokens: 800 },
    );

    const stream = this.llmPort.streamStructuredRequest(request);

    let fullResponse = "";
    for await (const chunkResult of stream) {
      if (!chunkResult.success) {
        return err(chunkResult.error);
      }
      const chunkData =
        typeof chunkResult.value === "string"
          ? chunkResult.value
          : (chunkResult.value as { content?: string })?.content || "";
      fullResponse += chunkData;
      if (onChunk && chunkData) {
        onChunk(chunkData);
      }
    }

    const lines = fullResponse.split("\n").filter((line) => line.trim() !== "");
    const contextPortsMap = new Map<
      string,
      { in: PortDefinition[]; out: PortDefinition[] }
    >();

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const { contextName, direction, name, portType, description } = parsed;

        if (!contextName || !direction || !name || !portType) continue;

        if (!contextPortsMap.has(contextName)) {
          contextPortsMap.set(contextName, { in: [], out: [] });
        }

        const ports = contextPortsMap.get(contextName)!;
        const coercedType = coercePortType(direction, portType);
        if (!coercedType) continue;

        if (direction === "in") {
          ports.in.push({
            name,
            type: coercedType as InboundPortType,
            description: description || "",
          });
        } else if (direction === "out") {
          ports.out.push({
            name,
            type: coercedType as OutboundPortType,
            description: description || "",
          });
        }
      } catch {
        // ignore malformed NDJSON lines
      }
    }

    const contexts: ContextPorts[] = [];
    for (const [contextName, ports] of contextPortsMap.entries()) {
      contexts.push({ contextName, in: ports.in, out: ports.out });
    }

    return ok({ contexts });
  }
}
