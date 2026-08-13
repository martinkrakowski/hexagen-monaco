import yaml from "js-yaml";
import type {
  ManifestViewData,
  BoundedContextView,
  PortEntry,
  AdapterEntry,
  ValidationItem,
} from "../model/manifest-view-data.js";

interface ManifestOutput {
  system?: string;
  scope?: string;
  architecture?: string;
  bounded_contexts?: ManifestContextOutput[];
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

function findLineRanges(
  yamlStr: string,
): Map<string, { start: number; end: number }> {
  const lines = yamlStr.split("\n");
  const ranges = new Map<string, { start: number; end: number }>();
  let currentContext: string | null = null;
  let currentStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^\s*-\s*name:\s*"?([^"]+)"?/);
    if (match) {
      if (currentContext) {
        ranges.set(currentContext, { start: currentStart, end: i - 1 });
      }
      currentContext = match[1];
      if (currentContext.startsWith("-") && match[1].startsWith("-")) {
        currentContext = match[1];
      }
      currentStart = i;
    }
  }
  if (currentContext) {
    ranges.set(currentContext, { start: currentStart, end: lines.length - 1 });
  }

  return ranges;
}

export function parseYamlToViewData(yamlString: string): ManifestViewData {
  const validationItems: ValidationItem[] = [];
  let parsed: ManifestOutput = {};

  try {
    parsed = (yaml.load(yamlString) as ManifestOutput) || {};
  } catch (e: unknown) {
    validationItems.push({
      status: "fail",
      title: "Invalid YAML",
      description:
        e instanceof Error ? e.message : "Failed to parse YAML document.",
    });
    return {
      system: "",
      scope: "",
      architecture: "",
      contexts: [],
      validationItems,
      overallScore: 0,
    };
  }

  if (parsed.scope) {
    validationItems.push({
      status: "pass",
      title: "Scope Defined",
      description: `Scope field present with value \`${parsed.scope}\`.`,
    });
  } else {
    validationItems.push({
      status: "fail",
      title: "Scope Missing",
      description: `Scope field is missing from the manifest.`,
    });
  }

  if (parsed.architecture) {
    validationItems.push({
      status: "pass",
      title: "Architecture Declared",
      description: `Architecture field specifies \`${parsed.architecture}\`.`,
    });
  } else {
    validationItems.push({
      status: "fail",
      title: "Architecture Missing",
      description: `Architecture field is missing from the manifest.`,
    });
  }

  const contexts: BoundedContextView[] = [];
  const rawContexts = parsed.bounded_contexts || [];
  const ranges = findLineRanges(yamlString);
  let validContractCount = 0;

  rawContexts.forEach((c) => {
    const name = c.name || "unnamed-context";
    // Preserve the full context-type vocabulary; only an unrecognized type falls
    // back to "supporting". (Previously `shared-kernel` and `generic` weren't
    // listed here and were silently coerced to "supporting".)
    const KNOWN_TYPES: ReadonlyArray<BoundedContextView["type"]> = [
      "core",
      "supporting",
      "generic",
      "shared-kernel",
      "driver",
    ];
    const type = (KNOWN_TYPES as readonly string[]).includes(c.type ?? "")
      ? (c.type as BoundedContextView["type"])
      : "supporting";
    const desc = c.description || "";

    // The --manifest-context-* vars hold HSL *components* (e.g. `235 40% 45%`),
    // so they must be wrapped in hsl() to be a valid CSS color — consumers use
    // colorToken directly (inline style.color, SVG stroke, color-mix) in
    // HexagonalArchitectureView. A bare `var(--token)` renders as an invalid
    // color and silently falls back.
    let colorToken = "hsl(var(--manifest-context-supporting))";
    if (type === "core") colorToken = "hsl(var(--manifest-context-core))";
    if (type === "driver") colorToken = "hsl(var(--manifest-context-driver))";
    if (type === "generic") colorToken = "hsl(var(--manifest-context-generic))";
    if (type === "shared-kernel")
      colorToken = "hsl(var(--manifest-context-shared-kernel))";

    const rawPortsIn = c.layers?.application?.ports?.in || [];
    const rawPortsOut = c.layers?.application?.ports?.out || [];
    const rawAdapters = c.layers?.infrastructure?.adapters || [];

    // A shared-kernel is type-only (R09): it legitimately owns no ports, so it
    // trivially satisfies the minimum-interface contract. This mirrors the server
    // pipeline, which skips shared-kernels in port mapping ("no ports to map").
    // Without this, a purged shared-kernel trips the "missing ports" warning, the
    // deterministic fixer re-synthesizes default ports, and an applied "purify"
    // fix is silently undone — fighting the user in a loop.
    if (
      type === "shared-kernel" ||
      (rawPortsIn.length > 0 && rawPortsOut.length > 0)
    ) {
      validContractCount++;
    }

    const healthReasons: string[] = [];
    let hasError = false;
    let hasWarn = false;

    if (name.startsWith("-")) {
      hasError = true;
      healthReasons.push(
        `Context Name "${name}" starts with hyphen — invalid identifier for code generation`,
      );
      validationItems.push({
        status: "fail",
        title: `Context Name "${name}"`,
        description: `Starts with hyphen — produces invalid identifiers in code generation.`,
        contextName: name,
      });
    }

    const portsIn: PortEntry[] = rawPortsIn.map((p) => {
      const isBang = p.includes("!");
      if (isBang) {
        hasWarn = true;
        validationItems.push({
          status: "warn",
          title: 'YAML Tag Indicator "!" in Names',
          description: `Port name \`${p}\` contains "!" — YAML tag indicator.`,
          contextName: name,
        });
      }
      return {
        name: p,
        hasIssue: isBang,
        issueMessage: isBang ? 'Contains YAML tag character "!"' : undefined,
      };
    });

    const adaptersList: AdapterEntry[] = rawAdapters.map((a) => {
      const isBang = a.includes("!");
      if (isBang) {
        hasWarn = true;
        validationItems.push({
          status: "warn",
          title: 'YAML Tag Indicator "!" in Names',
          description: `Adapter \`${a}\` contains "!" — YAML tag indicator.`,
          contextName: name,
        });
      }
      return {
        name: a,
        hasIssue: isBang,
        issueMessage: isBang ? 'Contains YAML tag character "!"' : undefined,
      };
    });

    const portsOut: PortEntry[] = rawPortsOut.map((p) => {
      const isBang = p.includes("!");
      if (isBang) {
        hasWarn = true;
      }

      const portBase = p.replace(/Port$/, "").replace(/!/g, "");
      const adapterBase = (a: AdapterEntry) =>
        a.name.replace(/Adapter$/, "").replace(/!/g, "");
      // First-match-wins: an adapter implements exactly one port here, and once
      // its `implements` is set a LATER port must never steal it. The fuzzy
      // cross-containment match used to let e.g. `StorageProxyPort` re-match
      // (and overwrite) `StorageAdapter` after `StoragePort` had already
      // claimed it — leaving `StoragePort` falsely "unconnected" while
      // `StorageProxyAdapter` sat unused. That FAIL was permanently unfixable:
      // the deterministic fixer's exact-base skip (manifest-violation-fixer)
      // sees the `Storage` base already present and refuses to synthesize, so
      // approve never unlocked. Only UNCLAIMED adapters are candidates, and an
      // exact base match is preferred over cross-containment so `StoragePort`
      // pairs with `StorageAdapter` regardless of the ports' declaration order.
      const matchedAdapter =
        adaptersList.find(
          (a) => a.implements === undefined && adapterBase(a) === portBase,
        ) ??
        adaptersList.find((a) => {
          if (a.implements !== undefined) return false;
          const adBase = adapterBase(a);
          return adBase.includes(portBase) || portBase.includes(adBase);
        });

      if (matchedAdapter) {
        matchedAdapter.implements = p;
      } else {
        hasError = true;
        healthReasons.push(`No adapter defined for outbound port: ${p}`);
      }

      return {
        name: p,
        hasIssue: isBang || !matchedAdapter,
        issueMessage: !matchedAdapter
          ? "No adapter defined for this port"
          : isBang
            ? 'Contains "!"'
            : undefined,
      };
    });

    if (rawPortsOut.length > 0 && rawAdapters.length === 0) {
      hasError = true;
      validationItems.push({
        status: "fail",
        title: `${name}: Zero Adapters`,
        description: `${rawPortsOut.length} outbound ports but \`infrastructure: {}\` is empty.`,
        contextName: name,
      });
    } else {
      const unconnected = portsOut.filter(
        (p) => !adaptersList.find((a) => a.implements === p.name),
      );
      if (unconnected.length > 0) {
        validationItems.push({
          status: "fail",
          title: `${name}: ${unconnected.length} Unconnected Ports`,
          description: `Missing adapters for: ${unconnected.map((p) => "'" + p.name + "'").join(", ")}.`,
          contextName: name,
        });
      } else if (portsOut.length > 0) {
        validationItems.push({
          status: "pass",
          title: `${name}: Connected`,
          description: `All outbound ports have matching adapters.`,
          contextName: name,
        });
      }
    }

    const health = hasError ? "error" : hasWarn ? "warning" : "healthy";
    const range = ranges.get(name) || { start: 0, end: 0 };

    contexts.push({
      name,
      type,
      description: desc,
      colorToken,
      portsIn,
      portsOut,
      adapters: adaptersList,
      health,
      healthReasons,
      yamlLineRange: range,
    });
  });

  if (rawContexts.length > 0) {
    if (validContractCount === rawContexts.length) {
      validationItems.push({
        status: "pass",
        title: "Minimum Interface Contract",
        description: `All bounded contexts define at least one port-in and one port-out, or are type-only shared-kernels (exempt).`,
      });
    } else {
      validationItems.push({
        status: "warn",
        title: "Minimum Interface Contract",
        description: `Some bounded contexts are missing ports in/out.`,
      });
    }
  }

  const uniqueValidation = Array.from(
    new Map(
      validationItems.map((item) => [item.title + item.description, item]),
    ).values(),
  );

  const passCount = uniqueValidation.filter((v) => v.status === "pass").length;
  const overallScore =
    uniqueValidation.length > 0
      ? Math.round((passCount / uniqueValidation.length) * 100)
      : 0;

  return {
    system: parsed.system || "",
    scope: parsed.scope || "",
    architecture: parsed.architecture || "",
    contexts,
    validationItems: uniqueValidation,
    overallScore,
  };
}
