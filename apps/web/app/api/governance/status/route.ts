import { NextResponse } from "next/server";
import { readdir, readFile } from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import type { Manifest } from "@hexagen/project-configuration";

interface PortAdapterStatus {
  context: string;
  ports: number;
  adapters: number;
  complete: boolean;
}

export async function GET() {
  try {
    const manifestPath = path.join(
      process.cwd(),
      ".architecture",
      "manifest.yaml",
    );
    let manifest: Manifest;

    try {
      const content = await readFile(manifestPath, "utf-8");
      const parsed = yaml.load(content) as Manifest;
      manifest = parsed;
    } catch {
      return NextResponse.json({ status: [] });
    }

    const packagesDir = path.join(process.cwd(), "packages");
    let packageNames: string[] = [];

    try {
      packageNames = await readdir(packagesDir);
    } catch {
      return NextResponse.json({ status: [] });
    }

    const status: PortAdapterStatus[] = [];

    for (const ctx of manifest.bounded_contexts || []) {
      const ports = ctx.layers?.application?.ports
        ? (ctx.layers.application.ports.in?.length || 0) +
          (ctx.layers.application.ports.out?.length || 0)
        : 0;

      const hasPackage = packageNames.includes(
        ctx.name.replace("@hexagen/", ""),
      );
      let adapterCount = 0;

      if (hasPackage) {
        const adapterPath = path.join(
          packagesDir,
          ctx.name.replace("@hexagen/", ""),
          "src",
          "infrastructure",
          "adapters",
        );
        try {
          const files = await readdir(adapterPath);
          adapterCount = files.filter(
            (f) => f.endsWith(".ts") || f.endsWith(".tsx"),
          ).length;
        } catch {
          adapterCount = 0;
        }
      }

      status.push({
        context: ctx.name,
        ports,
        adapters: adapterCount,
        complete: ports > 0 && adapterCount >= Math.ceil(ports / 2),
      });
    }

    return NextResponse.json({ status });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to get status",
      },
      { status: 500 },
    );
  }
}
