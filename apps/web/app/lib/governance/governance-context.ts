import { portName } from "@hexagen/sync";
import type {
  Manifest,
  ManifestBoundedContext,
} from "@hexagen/project-configuration";

/**
 * The compact governance context the in-browser LLM assistant is grounded on.
 *
 * HEX-034: this projection used to live inline in `app/api/llm/context/route.ts`
 * next to a workspace-root walk and a `mergeSplitManifest` call, so the only way
 * to exercise the port-ownership rules was to stand up an HTTP handler over the
 * repo's own `.architecture/` directory. Everything here is pure: manifest in,
 * payload out, no I/O. The read itself is the composition root's
 * `getMergedManifestProvider()`.
 */

export interface CompactBoundedContext {
  name: string;
  type: "core" | "supporting" | "shared-kernel" | "driver";
}

/** `portName → owning bounded-context name`. */
export interface PortOwnership {
  [port: string]: string;
}

export interface CompactInvariant {
  name: string;
  priority: "critical" | "high" | "medium";
}

export interface GovernanceContextPayload {
  system: string;
  scope: string;
  architecture: string;
  boundedContexts: CompactBoundedContext[];
  ports: PortOwnership;
  invariants: CompactInvariant[];
  timestamp: string;
}

/**
 * The invariants surfaced to the assistant. A hard-coded list, unchanged from
 * the route — the authoritative rule set lives in
 * `.architecture/invariants/linter-config.yaml`, and reading it here would be a
 * second, divergent parse of that file. Named and exported so the duplication is
 * addressable (and assertable) instead of buried in a request handler.
 */
export const GOVERNANCE_INVARIANTS: readonly CompactInvariant[] = [
  { name: "port-single-ownership", priority: "critical" },
  { name: "composite-safety", priority: "critical" },
  { name: "barrel-ownership-boundary", priority: "critical" },
  { name: "dependency-consistency", priority: "high" },
  { name: "self-import-prevention", priority: "high" },
  { name: "signature-synchronization", priority: "high" },
];

/** The payload served when no manifest could be read — not an error state. */
export function createEmptyGovernanceContext(): GovernanceContextPayload {
  return {
    system: "",
    scope: "",
    architecture: "",
    boundedContexts: [],
    ports: {},
    invariants: [],
    timestamp: new Date().toISOString(),
  };
}

/**
 * Project a merged manifest into the assistant's governance context.
 *
 * Port ownership is a flat `port → context` map, which encodes the
 * `port-single-ownership` invariant by construction: a port declared by two
 * contexts collapses to whichever context appears later. That is the historical
 * behaviour and is left as-is deliberately — the linter, not this projection, is
 * the authority on ownership violations.
 */
export function projectGovernanceContext(
  manifest: Manifest,
): GovernanceContextPayload {
  const contexts: ManifestBoundedContext[] = manifest.bounded_contexts || [];

  const boundedContexts: CompactBoundedContext[] = contexts.map((ctx) => ({
    name: ctx.name,
    type: (ctx.type as CompactBoundedContext["type"]) || "supporting",
  }));

  const ports: PortOwnership = {};
  for (const ctx of contexts) {
    const appPorts = ctx.layers?.application?.ports;
    for (const port of appPorts?.in || []) {
      ports[portName(port)] = ctx.name;
    }
    for (const port of appPorts?.out || []) {
      ports[portName(port)] = ctx.name;
    }
  }

  return {
    system: manifest.system || "unknown",
    scope: manifest.scope || "hexagen",
    architecture: manifest.architecture || "modular-monolith",
    boundedContexts,
    ports,
    invariants: [...GOVERNANCE_INVARIANTS],
    timestamp: new Date().toISOString(),
  };
}
