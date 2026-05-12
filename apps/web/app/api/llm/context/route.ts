import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { mergeSplitManifest } from "@hexagen/project-configuration/server";
import { portName } from "@hexagen/sync";
import type {
  Manifest,
  ManifestBoundedContext,
} from "@hexagen/project-configuration";

interface CompactBoundedContext {
  name: string;
  type: "core" | "supporting" | "shared-kernel" | "driver";
}

interface PortOwnership {
  [portName: string]: string;
}

interface CompactInvariant {
  name: string;
  priority: "critical" | "high" | "medium";
}

interface GovernancePayload {
  system: string;
  scope: string;
  architecture: string;
  boundedContexts: CompactBoundedContext[];
  ports: PortOwnership;
  invariants: CompactInvariant[];
  timestamp: string;
}

function createEmptyPayload(): GovernancePayload {
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

async function findWorkspaceRoot(start: string): Promise<string | null> {
  const manifestPath = path.join(start, ".architecture", "manifest.yaml");
  try {
    await readFile(manifestPath, "utf-8");
    return start;
  } catch {
    const parent = path.dirname(start);
    if (parent === start) return null;
    return findWorkspaceRoot(parent);
  }
}

export async function GET(): Promise<
  NextResponse<GovernancePayload | { error: string }>
> {
  try {
    const workspaceRoot = await findWorkspaceRoot(process.cwd());
    if (!workspaceRoot) {
      return NextResponse.json(createEmptyPayload(), { status: 200 });
    }

    const manifestPath = path.join(
      workspaceRoot,
      ".architecture",
      "manifest.yaml",
    );

    let manifest: Manifest;
    try {
      manifest = await mergeSplitManifest(workspaceRoot, manifestPath);
    } catch {
      return NextResponse.json(createEmptyPayload(), { status: 200 });
    }

    const boundedContexts: CompactBoundedContext[] = (
      manifest.bounded_contexts || []
    ).map((ctx: ManifestBoundedContext) => ({
      name: ctx.name,
      type: (ctx.type as CompactBoundedContext["type"]) || "supporting",
    }));

    const ports: PortOwnership = {};
    for (const ctx of manifest.bounded_contexts || []) {
      const appPorts = ctx.layers?.application?.ports;

      const inPorts = [...(appPorts?.in || []).map(portName)];
      const outPorts = [...(appPorts?.out || []).map(portName)];

      for (const portStr of inPorts) {
        ports[portStr] = ctx.name;
      }
      for (const portStr of outPorts) {
        ports[portStr] = ctx.name;
      }
    }

    const defaultInvariants: CompactInvariant[] = [
      { name: "port-single-ownership", priority: "critical" },
      { name: "composite-safety", priority: "critical" },
      { name: "barrel-ownership-boundary", priority: "critical" },
      { name: "dependency-consistency", priority: "high" },
      { name: "self-import-prevention", priority: "high" },
      { name: "signature-synchronization", priority: "high" },
    ];

    const payload: GovernancePayload = {
      system: manifest.system || "unknown",
      scope: manifest.scope || "hexagen",
      architecture: manifest.architecture || "modular-monolith",
      boundedContexts,
      ports,
      invariants: defaultInvariants,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
