import { NextResponse } from "next/server";
import * as yaml from "js-yaml";
import { logger } from "../../../../lib/structured-logger";

interface Violation {
  id: string;
  type: "error" | "warning" | "info";
  message: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
}

interface ViolationsRequestBody {
  manifestYaml: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ViolationsRequestBody;

    if (!body.manifestYaml) {
      return NextResponse.json(
        { error: "manifestYaml is required" },
        { status: 400 },
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = yaml.load(body.manifestYaml) as Record<string, unknown>;
    } catch {
      return NextResponse.json({
        violations: [],
        isCompliant: true,
      });
    }

    const boundedContexts = parsed.bounded_contexts as
      | Array<Record<string, unknown>>
      | undefined;

    if (!boundedContexts || boundedContexts.length === 0) {
      return NextResponse.json({
        violations: [],
        isCompliant: true,
      });
    }

    const violations: Violation[] = [];

    for (const ctx of boundedContexts) {
      const ctxName = ctx.name as string;
      const layers = ctx.layers as Record<string, unknown> | undefined;
      const domainLayer = layers?.domain as Record<string, unknown> | undefined;
      const adapters = domainLayer?.adapters as
        | Record<string, unknown>
        | undefined;

      const adapterCount = adapters ? Object.keys(adapters).length : 0;
      const appLayer = layers?.application as
        | Record<string, unknown>
        | undefined;
      const portConfig = appLayer?.ports as Record<string, unknown> | undefined;
      const ports = portConfig
        ? Object.keys(portConfig?.in || {}).length +
          Object.keys(portConfig?.out || {}).length
        : 0;

      if (ports > 0 && adapterCount === 0) {
        violations.push({
          id: `${ctxName}-missing-adapters`,
          type: "warning",
          message: `Context "${ctxName}" has ${ports} port(s) but no adapters implemented`,
          severity: "MEDIUM",
        });
      }

      const dependencies = ctx.dependencies as
        | Array<Record<string, unknown>>
        | undefined;
      if (dependencies) {
        for (const dep of dependencies) {
          const depName = dep.name as string;
          if (depName === ctxName) {
            violations.push({
              id: `${ctxName}-self-dependency`,
              type: "error",
              message: `Context "${ctxName}" depends on itself`,
              severity: "HIGH",
            });
          }
        }
      }
    }

    return NextResponse.json({
      violations,
      isCompliant: violations.filter((v) => v.type === "error").length === 0,
    });
  } catch (err) {
    logger.error("Governance violations error:", { error: err });
    return NextResponse.json(
      {
        error: "Internal Server Error",
        violations: [],
        isCompliant: false,
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json(
    {
      error: "Use POST with manifestYaml in request body",
      violations: [],
      isCompliant: true,
    },
    {
      status: 405,
      headers: { Allow: "POST" },
    },
  );
}
