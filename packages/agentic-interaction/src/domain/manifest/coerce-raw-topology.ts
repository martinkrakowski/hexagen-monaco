import {
  BOUNDED_CONTEXT_TYPES,
  type BoundedContextType,
} from "@hexagen/shared";

export interface RawPort {
  name: string;
  type: string;
  description: string;
}

export interface RawPortsObject {
  in: RawPort[];
  out: RawPort[];
}

export interface RawContext {
  name: string;
  type: string;
  description: string;
  ports?: RawPortsObject;
  adapters?: Array<{ name: string; type: string; implements: string }>;
}

// Re-exported from the canonical single source (@hexagen/shared) so this
// coercion path recognizes every bounded-context type — notably "driver",
// which it previously dropped to "core".
export type { BoundedContextType };

function toKebabCase(input: string): string {
  return input
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function ensurePortSuffix(name: string): string {
  const trimmed = name.trim();
  if (trimmed.endsWith("Port")) return trimmed;
  return `${trimmed}Port`;
}

/**
 * Coerce a context type string to a valid BoundedContextType.
 * Defaults to 'core' if the type is empty or invalid.
 */
export function coerceContextType(type: string): BoundedContextType {
  const trimmed = (type ?? "").trim().toLowerCase();

  if ((BOUNDED_CONTEXT_TYPES as readonly string[]).includes(trimmed)) {
    return trimmed as BoundedContextType;
  }

  // Default to core for empty or invalid types
  return "core";
}

export function coercePortName(name: string): string {
  return ensurePortSuffix(name.trim());
}

export function coercePort(
  port: Record<string, unknown>,
  direction: "in" | "out",
): RawPort {
  const name = coercePortName(String(port.name ?? ""));
  const defaultType = direction === "in" ? "use-case" : "infrastructure";
  const rawType = String(port.type ?? "").trim();
  const type = rawType || defaultType;
  const rawDesc = String(port.description ?? "").trim();
  const descBase = name.replace(/Port$/, "");
  const description = rawDesc || `${descBase} port`;
  return { name, type, description };
}

export function coerceContextName(name: string): string {
  return toKebabCase(name);
}

export function coerceRawPorts(ports: unknown): RawPortsObject {
  let raw = ports as { in?: unknown[]; out?: unknown[] };

  if (
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    !("in" in raw) &&
    !("out" in raw)
  ) {
    const obj = raw as Record<string, unknown>;
    for (const key of ["ports", "data", "result"]) {
      if (
        typeof obj[key] === "object" &&
        obj[key] !== null &&
        !Array.isArray(obj[key])
      ) {
        raw = obj[key] as { in?: unknown[]; out?: unknown[] };
        break;
      }
    }
  }

  const inPorts = Array.isArray(raw?.in) ? raw.in : [];
  const outPorts = Array.isArray(raw?.out) ? raw.out : [];
  return {
    in: inPorts.map((p) => coercePort(p as Record<string, unknown>, "in")),
    out: outPorts.map((p) => coercePort(p as Record<string, unknown>, "out")),
  };
}

export function coerceRawTopology(contexts: RawContext[]): RawContext[] {
  return contexts.map((ctx) => ({
    ...ctx,
    name: coerceContextName(ctx.name),
    type: coerceContextType(ctx.type), // Apply type coercion here
    ports: ctx.ports ? coerceRawPorts(ctx.ports) : ctx.ports,
  }));
}
