import { NextResponse } from "next/server";
import * as yaml from "js-yaml";

interface PortAdapterStatus {
  context: string;
  ports: number;
  adapters: number;
  complete: boolean;
}

interface StatusRequestBody {
  manifestYaml: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as StatusRequestBody;

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
      return NextResponse.json({ status: [] });
    }

    const boundedContexts = parsed.bounded_contexts as
      | Array<Record<string, unknown>>
      | undefined;

    if (!boundedContexts) {
      return NextResponse.json({ status: [] });
    }

    const status: PortAdapterStatus[] = [];

    for (const ctx of boundedContexts) {
      const ctxName = ctx.name as string;
      const layers = ctx.layers as Record<string, unknown> | undefined;

      const portsConfig = (layers?.application as Record<string, unknown>)?.ports as
        | Record<string, unknown>
        | undefined;
      const inPorts = portsConfig?.in as string[] | undefined;
      const outPorts = portsConfig?.out as string[] | undefined;

      const ports = (inPorts?.length || 0) + (outPorts?.length || 0);

      const domainLayer = layers?.domain as
        | Record<string, unknown>
        | undefined;
      const adapters = domainLayer?.adapters as
        | Record<string, unknown>
        | undefined;
      const adapterCount = adapters ? Object.keys(adapters).length : 0;

      status.push({
        context: ctxName,
        ports,
        adapters: adapterCount,
        complete: ports > 0 && adapterCount >= Math.ceil(ports / 2),
      });
    }

    return NextResponse.json({ status });
  } catch {
    return NextResponse.json({ status: [] });
  }
}

export async function GET() {
  return NextResponse.json({ status: [] });
}