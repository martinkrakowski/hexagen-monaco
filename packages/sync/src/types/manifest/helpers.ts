import type { BoundedContext } from "./bounded-context.js";

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
    inPorts.push(...(context.layers.application.ports.in ?? []));
    outPorts.push(...(context.layers.application.ports.out ?? []));
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

export function expandDependsOn(
  context: BoundedContext,
): Record<string, string> {
  return Object.fromEntries(
    (context.depends_on ?? []).map((name) => [
      `@hexagen/${name}`,
      "workspace:*",
    ]),
  );
}
