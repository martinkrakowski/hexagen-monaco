import type { PortsList } from "@hexagen/agentic-interaction";
import {
  PortsListSchema,
  parseJSON,
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

      // Try parsing as full JSON first (array or object wrapper)
      // LLMs often ignore "NDJSON" instruction and return pretty JSON array
      let items: unknown[] = [];
      const fullParsed = parseJSON<unknown>(content);

      if (fullParsed.ok) {
        const data = fullParsed.data;
        if (Array.isArray(data)) {
          items = data;
        } else if (typeof data === "object" && data !== null) {
          const obj = data as Record<string, unknown>;
          // Check for { in: [...], out: [...] } shape (legacy)
          if (Array.isArray(obj.in) || Array.isArray(obj.out)) {
            const inArr = (Array.isArray(obj.in) ? obj.in : []) as unknown[];
            const outArr = (Array.isArray(obj.out) ? obj.out : []) as unknown[];
            items = [
              ...inArr.map((p) => ({ ...(p as object), direction: "in" })),
              ...outArr.map((p) => ({ ...(p as object), direction: "out" })),
            ];
          } else {
            // Check for wrapped array: { ports: [...] } or similar
            for (const key of ["ports", "data", "items", "results", "list"]) {
              if (Array.isArray(obj[key])) {
                items = obj[key] as unknown[];
                break;
              }
            }
            // Single object fallback
            if (items.length === 0 && ("name" in obj || "direction" in obj)) {
              items = [data];
            }
          }
        }
      }

      // Fallback: parse as NDJSON (one object per line)
      if (items.length === 0) {
        const lines = content
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

        for (const line of lines) {
          const parsed = parseJSON<Record<string, unknown>>(line);
          if (parsed.ok) {
            items.push(parsed.data);
          }
        }
      }

      if (items.length === 0) {
        if (attempt === MAX_RETRIES) break;
        continue;
      }

      const inPorts: Array<{
        name: string;
        type: string;
        description: string;
      }> = [];
      const outPorts: Array<{
        name: string;
        type: string;
        description: string;
      }> = [];

      for (const item of items) {
        if (typeof item !== "object" || item === null) continue;
        const obj = item as Record<string, unknown>;

        const portEntry = {
          name: String(obj.name || ""),
          type: String(obj.portType || obj.type || ""),
          description: String(obj.description || obj.name || ""),
        };

        if (!portEntry.name) continue;

        if (obj.direction === "in") {
          inPorts.push(portEntry);
        } else if (obj.direction === "out") {
          outPorts.push(portEntry);
        }
      }

      const portsData: PortsList = { in: inPorts, out: outPorts };

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
