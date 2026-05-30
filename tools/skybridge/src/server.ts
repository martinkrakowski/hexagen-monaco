import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  AuditBoundariesToolUseCase,
  createDefaultMCPCompositionRoot,
} from "@hexagen/mcp-server";
import { McpServer } from "skybridge/server";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Domain-boundary validation (presentation layer)
//
// This Skybridge tool is a thin presentation + distribution layer. It does NOT
// re-implement boundary analysis — it delegates to the hexagen-monaco
// governance engine by running the very same `AuditBoundariesToolUseCase` the
// `hexagen-mcp` stdio server exposes, then renders the resulting LinterReport
// in the BoundaryValidator view. Both systems are used: the engine produces the
// report, Skybridge presents it inside ChatGPT / Claude.
// ---------------------------------------------------------------------------

/**
 * Walk upward from `start` to the monorepo root — the first ancestor holding
 * `.architecture/manifest.yaml` (what the governance engine expects as its
 * workspace root). Falls back to `start` so callers always get a usable base.
 */
function findWorkspaceRoot(start: string): string {
  const hasManifest = (dir: string) =>
    existsSync(resolve(dir, ".architecture/manifest.yaml"));

  let dir = start;
  let parent = dirname(dir);
  while (dir !== parent) {
    if (hasManifest(dir)) return dir;
    dir = parent;
    parent = dirname(dir);
  }
  // `dir` is now the filesystem root; check it too before giving up.
  return hasManifest(dir) ? dir : start;
}

async function validateDomainBoundaries(args: {
  dry_run?: boolean;
  workspace_root?: string;
}) {
  const workspaceRoot = args.workspace_root
    ? resolve(process.cwd(), args.workspace_root)
    : findWorkspaceRoot(process.cwd());

  // Compose the hexagen-monaco governance engine via its public composition
  // root, then delegate to its audit use case. No boundary logic lives here.
  const root = createDefaultMCPCompositionRoot(workspaceRoot);
  const audit = new AuditBoundariesToolUseCase(root.linterPort);

  try {
    const { dryRun, report } = await audit.execute({
      dry_run: args.dry_run ?? true,
    });

    const errors = report.violations.filter(
      (v) => v.severity === "error",
    ).length;
    const warnings = report.violations.filter(
      (v) => v.severity === "warning",
    ).length;

    const structuredContent = {
      ok: true as const,
      workspaceRoot,
      dryRun,
      timestamp: report.timestamp,
      isCompliant: report.isCompliant,
      scannedFilesCount: report.scannedFilesCount,
      summary: {
        violations: report.violations.length,
        errors,
        warnings,
        status: report.isCompliant
          ? ("clean" as const)
          : ("violations" as const),
      },
      violations: report.violations,
    };

    const headline = report.isCompliant
      ? `✅ Architecture compliant — ${report.scannedFilesCount} file(s) scanned, no boundary violations.`
      : `⚠️ ${errors} error(s), ${warnings} warning(s) across ${report.scannedFilesCount} scanned file(s).`;

    return {
      structuredContent,
      content: [{ type: "text" as const, text: headline }],
      isError: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      structuredContent: { ok: false as const, workspaceRoot, error: message },
      content: [
        {
          type: "text" as const,
          text: `Boundary audit failed: ${message}`,
        },
      ],
      isError: true,
    };
  }
}

const server = new McpServer(
  {
    name: "hexagen-architecture-tools",
    version: "0.1.0",
  },
  { capabilities: {} },
).registerTool(
  {
    name: "validate_domain_boundaries",
    description:
      "Audit hexagonal architecture boundaries across the hexagen-monaco monorepo. Delegates to the @hexagen/mcp-server governance engine (AuditBoundariesToolUseCase) and renders the LinterReport.",
    inputSchema: {
      dry_run: z
        .boolean()
        .optional()
        .describe(
          "Run the audit without persisting any governance side effects. Defaults to true.",
        ),
      workspace_root: z
        .string()
        .optional()
        .describe(
          "Monorepo workspace root. Defaults to the nearest ancestor containing .architecture/manifest.yaml.",
        ),
    },
    annotations: {
      title: "Validate domain boundaries",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    _meta: {
      "openai/toolInvocation/invoking": "Auditing architecture boundaries…",
      "openai/toolInvocation/invoked": "Boundary audit complete.",
    },
    view: {
      component: "BoundaryValidator",
      description: "Domain boundary audit report",
    },
  },
  async ({ dry_run, workspace_root }) =>
    validateDomainBoundaries({ dry_run, workspace_root }),
);

if (process.env.NODE_ENV === "production") {
  const { default: manifest } = await import("./vite-manifest.js");
  server.setViteManifest(manifest);
}

export default await server.run();

export type AppType = typeof server;
