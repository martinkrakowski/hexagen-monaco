import yaml from "js-yaml";

export interface ImportedContextPorts {
  context: string;
  inPorts: string[];
  outPorts: string[];
}

/**
 * List the real named ports per bounded context from a stored manifest, for
 * the read-only "ports are managed by the imported manifest" banner on the
 * port-configuration step (import round-trip integrity, Item 1.4).
 *
 * Deliberately TOLERANT (unlike parseImportedManifest, which fails closed for
 * exports): this feeds a display-only banner, so any parse/shape problem
 * degrades to an empty list rather than blocking the wizard. Port entries may
 * be plain strings or `{ name }` objects (LegacyOrNewPortSchema accepts both).
 */
export function listImportedManifestPorts(
  manifestYaml: string | null | undefined,
): ImportedContextPorts[] {
  if (typeof manifestYaml !== "string" || manifestYaml.trim() === "") {
    return [];
  }

  let doc: unknown;
  try {
    // JSON is a subset of YAML, so this also covers records whose manifestYaml
    // was written as JSON text by the pre-fix autosave path.
    doc = yaml.load(manifestYaml);
  } catch {
    return [];
  }
  if (typeof doc !== "object" || doc === null) return [];

  const contexts = (doc as Record<string, unknown>).bounded_contexts;
  if (!Array.isArray(contexts)) return [];

  const result: ImportedContextPorts[] = [];
  for (const context of contexts) {
    if (typeof context !== "object" || context === null) continue;
    const record = context as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : null;
    if (!name) continue;

    const layers = record.layers;
    const application =
      typeof layers === "object" && layers !== null
        ? (layers as Record<string, unknown>).application
        : undefined;
    const ports =
      typeof application === "object" && application !== null
        ? (application as Record<string, unknown>).ports
        : undefined;
    const portsRecord =
      typeof ports === "object" && ports !== null
        ? (ports as Record<string, unknown>)
        : undefined;

    result.push({
      context: name,
      inPorts: extractPortNames(portsRecord?.in),
      outPorts: extractPortNames(portsRecord?.out),
    });
  }
  return result;
}

function extractPortNames(entries: unknown): string[] {
  if (!Array.isArray(entries)) return [];
  const names: string[] = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      names.push(entry);
    } else if (typeof entry === "object" && entry !== null) {
      const name = (entry as Record<string, unknown>).name;
      if (typeof name === "string") names.push(name);
    }
  }
  return names;
}
