import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import yaml from "js-yaml";

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

export async function GET(): Promise<NextResponse<GovernancePayload | { error: string }>> {
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

    let manifestContent: string;
    try {
      manifestContent = await readFile(manifestPath, "utf-8");
    } catch {
      return NextResponse.json(createEmptyPayload(), { status: 200 });
    }

    let manifest: Record<string, unknown>;
    try {
      manifest = yaml.load(manifestContent) as Record<string, unknown>;
    } catch {
      return NextResponse.json(createEmptyPayload(), { status: 200 });
    }

    const boundedContextsArray = manifest.bounded_contexts as
      | Array<Record<string, unknown>>
      | undefined;

    const boundedContexts: CompactBoundedContext[] = (
      boundedContextsArray || []
    ).map((ctx) => ({
      name: ctx.name as string,
      type: (ctx.type as CompactBoundedContext["type"]) || "supporting",
    }));

    const ports: PortOwnership = {};
    for (const ctx of boundedContextsArray || []) {
      const layers = ctx.layers as Record<string, unknown> | undefined;
      const appLayer = layers?.application as
        | Record<string, unknown>
        | undefined;
      const portConfig = appLayer?.ports as Record<string, unknown> | undefined;

      const inPorts = (portConfig?.in as string[] | undefined) || [];
      const outPorts = (portConfig?.out as string[] | undefined) || [];

      for (const portName of inPorts) {
        ports[portName] = ctx.name as string;
      }
      for (const portName of outPorts) {
        ports[portName] = ctx.name as string;
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
      system: (manifest.system as string) || "unknown",
      scope: (manifest.scope as string) || "hexagen",
      architecture: (manifest.architecture as string) || "modular-monolith",
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
