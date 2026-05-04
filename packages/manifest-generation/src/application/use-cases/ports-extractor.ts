import type { PortsList } from "@hexagen/agentic-interaction";
import {
  PortsListSchema,
  parseJSON,
  extractObjectFromWrapper,
  coerceRawPorts,
  PORTS_LIST_SYSTEM_PROMPT,
  compilePortsPrompt,
} from "@hexagen/agentic-interaction";
import type { LocalLlmMessagingPort } from "../ports/out/local-llm-messaging.port.js";
import { MAX_RETRIES } from "./context-list-extractor.js";

interface Port {
  name: string;
  type: string;
  description: string;
}

function normalizePort(input: unknown, defaultType: string): Port {
  if (typeof input === "string") {
    return {
      name: input,
      type: defaultType,
      description: `Port ${input}`,
    };
  }

  if (typeof input === "object" && input !== null) {
    const obj = input as Record<string, unknown>;
    if (typeof obj.name !== "string") {
      throw new Error(
        `Invalid port: missing or non-string name. Got: ${JSON.stringify(input)}`,
      );
    }
    return {
      name: obj.name,
      type: typeof obj.type === "string" ? obj.type : defaultType,
      description:
        typeof obj.description === "string"
          ? obj.description
          : `Port ${obj.name}`,
    };
  }

  throw new Error(
    `Invalid port format: expected string or object, got ${typeof input}. Full value: ${JSON.stringify(input)}`,
  );
}

async function attemptPortsForContext(
  messagingPort: LocalLlmMessagingPort,
  contextName: string,
  contextDescription: string,
  contextType: string,
  signal?: AbortSignal,
  onStepDetail?: (detail: string) => void,
): Promise<
  | { ok: true; ports: PortsList; degraded?: boolean }
  | { ok: false; error: string }
> {
  const userPrompt = compilePortsPrompt(
    contextName,
    contextDescription,
    contextType,
  );

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) return { ok: false, error: "Aborted" };

    try {
      onStepDetail?.(
        `Extracting ports for ${contextName}${attempt > 0 ? ` (attempt ${attempt + 1})` : ""}...`,
      );
      const content = await messagingPort.sendStructuredPrompt(
        userPrompt,
        PORTS_LIST_SYSTEM_PROMPT,
        signal,
      );
      if (!content) {
        if (attempt === MAX_RETRIES) break;
        continue;
      }

      const parsed = parseJSON<PortsList>(content);
      if (!parsed.ok) {
        if (attempt === MAX_RETRIES) break;
        continue;
      }

      let portsData = parsed.data;
      if (
        !Array.isArray(portsData) &&
        typeof portsData === "object" &&
        portsData !== null
      ) {
        const obj = portsData as Record<string, unknown>;
        if (typeof obj.in === "undefined" && typeof obj.out === "undefined") {
          const unwrapped = extractObjectFromWrapper<Record<string, unknown>>(
            portsData,
            ["ports", "data", "result"],
          );
          if (unwrapped) {
            portsData = unwrapped as PortsList;
          }
        }
      }

      const coerced = coerceRawPorts(portsData);
      portsData = { in: coerced.in, out: coerced.out };

      const result = PortsListSchema.safeParse(portsData);
      if (!result.success) {
        if (attempt === MAX_RETRIES) break;
        continue;
      }

      onStepDetail?.(
        `${contextName}: ${result.data.in.length} inbound, ${result.data.out.length} outbound ports`,
      );
      return { ok: true, ports: result.data };
    } catch (error) {
      if (attempt === MAX_RETRIES) break;
    }
  }

  return {
    ok: true,
    ports: { in: [], out: [] },
    degraded: true,
  };
}

export { attemptPortsForContext, normalizePort };
export type { Port };
