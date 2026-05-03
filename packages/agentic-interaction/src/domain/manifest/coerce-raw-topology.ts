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

export function coercePortName(name: string): string {
  return ensurePortSuffix(name.trim());
}

export function coerceContextName(name: string): string {
  return toKebabCase(name);
}

export function coerceRawPorts(ports: RawPortsObject): RawPortsObject {
  return {
    in: ports.in.map((p) => ({ ...p, name: coercePortName(p.name) })),
    out: ports.out.map((p) => ({ ...p, name: coercePortName(p.name) })),
  };
}

export function coerceRawTopology(contexts: RawContext[]): RawContext[] {
  return contexts.map((ctx) => ({
    ...ctx,
    name: coerceContextName(ctx.name),
    ports: ctx.ports ? coerceRawPorts(ctx.ports) : ctx.ports,
  }));
}
