import yaml from "js-yaml";
import type { ValidationItem } from "./manifest-view-data";

interface ManifestOutput {
  system?: string;
  scope?: string;
  architecture?: string;
  bounded_contexts?: ManifestContextOutput[];
  apps?: unknown[];
}

interface ManifestContextOutput {
  name?: string;
  type?: string;
  description?: string;
  layers?: {
    domain?: Record<string, unknown>;
    application?: {
      ports?: {
        in?: string[];
        out?: string[];
      };
    };
    infrastructure?: {
      adapters?: string[];
    };
  };
}

const YAML_DUMP_OPTIONS: yaml.DumpOptions = {
  indent: 2,
  lineWidth: -1,
  noRefs: true,
  sortKeys: false,
  quotingType: '"',
  forceQuotes: false,
  skipInvalid: false,
};

function portToAdapterName(portName: string): string {
  const base = portName.replace(/Port$/, "").replace(/!/g, "");
  return `${base}Adapter`;
}

function stripBangs(value: string): string {
  return value.replace(/!/g, "");
}

function fixContextName(name: string): string {
  let fixed = name;
  while (fixed.startsWith("-")) {
    fixed = fixed.slice(1);
  }
  return fixed;
}

function findContextIndex(
  contexts: ManifestContextOutput[],
  contextName: string | undefined,
): number {
  if (!contextName) return -1;
  const direct = contexts.findIndex((c) => c.name === contextName);
  if (direct !== -1) return direct;
  const cleaned = fixContextName(contextName);
  return contexts.findIndex((c) => c.name === cleaned);
}

export function canAutoFix(violation: ValidationItem): boolean {
  const title = violation.title;
  const desc = violation.description;
  if (title === "Invalid YAML") return false;
  if (title === "Minimum Interface Contract" && desc.includes("missing ports"))
    return false;
  if (title === "Scope Missing") return true;
  if (title === "Architecture Missing") return true;
  if (title.includes("Context Name") && desc.includes("Starts with hyphen"))
    return true;
  if (desc.includes("YAML tag indicator") || desc.includes('contains "!"'))
    return true;
  if (title.includes("Zero Adapters") || title.includes("Unconnected"))
    return true;
  return false;
}

export function applyDeterministicFix(
  yamlString: string,
  violation: ValidationItem,
): string | null {
  let parsed: ManifestOutput;
  try {
    parsed = (yaml.load(yamlString) as ManifestOutput) || {};
  } catch {
    return null;
  }

  const title = violation.title;
  const desc = violation.description;
  let changed = false;

  if (title === "Scope Missing") {
    if (!parsed.scope) {
      parsed.scope = "internal";
      changed = true;
    }
  } else if (title === "Architecture Missing") {
    if (!parsed.architecture) {
      parsed.architecture = "modular-monolith";
      changed = true;
    }
  } else if (
    title.includes("Context Name") &&
    desc.includes("Starts with hyphen")
  ) {
    const contexts = parsed.bounded_contexts || [];
    parsed.bounded_contexts = contexts.map((c) => {
      if (c.name && c.name.startsWith("-")) {
        changed = true;
        return { ...c, name: fixContextName(c.name) };
      }
      return c;
    });
  } else if (
    desc.includes("YAML tag indicator") ||
    desc.includes('contains "!"')
  ) {
    const ctxIdx = findContextIndex(
      parsed.bounded_contexts || [],
      violation.contextName,
    );
    const contexts = parsed.bounded_contexts || [];
    parsed.bounded_contexts = contexts.map((c, i) => {
      if (ctxIdx !== -1 && i !== ctxIdx) return c;
      const portsIn = (c.layers?.application?.ports?.in || []).map(stripBangs);
      const portsOut = (c.layers?.application?.ports?.out || []).map(
        stripBangs,
      );
      const adapters = (c.layers?.infrastructure?.adapters || []).map(
        stripBangs,
      );
      const hadBangs =
        (c.layers?.application?.ports?.in || []).some((p) => p.includes("!")) ||
        (c.layers?.application?.ports?.out || []).some((p) =>
          p.includes("!"),
        ) ||
        (c.layers?.infrastructure?.adapters || []).some((a) => a.includes("!"));
      if (!hadBangs) return c;
      changed = true;
      return {
        ...c,
        layers: {
          ...c.layers,
          application: {
            ...c.layers?.application,
            ports: { in: portsIn, out: portsOut },
          },
          infrastructure: { ...c.layers?.infrastructure, adapters },
        },
      };
    });
  } else if (title.includes("Zero Adapters") || title.includes("Unconnected")) {
    const ctxIdx = findContextIndex(
      parsed.bounded_contexts || [],
      violation.contextName,
    );
    if (ctxIdx === -1) return null;

    const contexts = [...(parsed.bounded_contexts || [])];
    const c = contexts[ctxIdx];
    const portsOut = c.layers?.application?.ports?.out || [];
    const existingAdapters = c.layers?.infrastructure?.adapters || [];
    const existingBases = new Set(
      existingAdapters.map((a) => a.replace(/Adapter$/, "").replace(/!/g, "")),
    );

    const missingAdapters = portsOut
      .filter((p) => {
        const base = p.replace(/Port$/, "").replace(/!/g, "");
        return !existingBases.has(base);
      })
      .map(portToAdapterName);

    if (missingAdapters.length === 0) return null;

    changed = true;
    contexts[ctxIdx] = {
      ...c,
      layers: {
        ...c.layers,
        infrastructure: {
          ...c.layers?.infrastructure,
          adapters: [...existingAdapters, ...missingAdapters],
        },
      },
    };
    parsed.bounded_contexts = contexts;
  }

  if (!changed) return null;
  return yaml.dump(parsed, YAML_DUMP_OPTIONS);
}
