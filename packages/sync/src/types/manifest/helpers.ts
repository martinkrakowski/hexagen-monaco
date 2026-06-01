import type { BoundedContext } from "./bounded-context.js";
import type { LegacyOrNewPort } from "./layers.js";
import type { Manifest } from "./manifest.js";

export function portName(port: LegacyOrNewPort): string {
  return typeof port === "string" ? port : port.name;
}

export function extractPorts(context: BoundedContext): {
  inPorts: string[];
  outPorts: string[];
} {
  const inPorts: string[] = [];
  const outPorts: string[] = [];

  if (context.layers?.domain?.ports) {
    inPorts.push(...(context.layers.domain.ports.in ?? []));
    outPorts.push(...(context.layers.domain.ports.out ?? []));
  }

  if (context.layers?.application?.ports) {
    inPorts.push(...(context.layers.application.ports.in ?? []).map(portName));
    outPorts.push(
      ...(context.layers.application.ports.out ?? []).map(portName),
    );
  }

  return { inPorts, outPorts };
}

export function extractDependencies(context: BoundedContext): string[] {
  return context.depends_on ?? [];
}

export function isSharedKernel(context: BoundedContext): boolean {
  return context.type === "shared-kernel";
}

export function isDriver(context: BoundedContext): boolean {
  return context.type === "driver";
}

/**
 * Sanitize an arbitrary string into a legal npm scope (without the leading `@`).
 *
 * npm scope rules (reimplemented inline — no external dep): lowercase, may
 * contain `[a-z0-9-._]`, no leading `@`, no consecutive separators, ≤214 chars.
 * Anything that sanitizes to empty falls back to `"generated-project"`.
 */
export function sanitizeScope(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/[._-]{2,}/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 214);
  return cleaned.length > 0 ? cleaned : "generated-project";
}

/**
 * The npm scope (without `@`) for a generated project's *own* packages —
 * `@{scope}/<pkg>`. Single source of truth for project namespacing.
 *
 * Precedence: `manifest.scope` → `manifest.system` → `"generated-project"`,
 * then sanitized. Distinct from the `@hexagen/*` tooling devDependencies, which
 * are the published generator packages, not the project's namespace.
 */
export function resolveScope(manifest: Manifest): string {
  const raw =
    typeof manifest.scope === "string" && manifest.scope.length > 0
      ? manifest.scope
      : typeof manifest.system === "string" && manifest.system.length > 0
        ? manifest.system
        : "generated-project";
  return sanitizeScope(raw);
}

export function expandDependsOn(
  context: BoundedContext,
  scope: string,
): Record<string, string> {
  return Object.fromEntries(
    (context.depends_on ?? []).map((name) => [
      `@${scope}/${name}`,
      "workspace:*",
    ]),
  );
}
