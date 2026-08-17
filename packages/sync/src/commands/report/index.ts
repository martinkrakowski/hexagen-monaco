/* eslint-disable no-console */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadManifest } from "../../manifest-service.js";
import { getProjectRoot } from "../shared/project-root.js";
import { buildEngagementReport } from "./build-report.js";
import { createGitReader } from "./exec-git.js";
import { buildHandoffZip } from "./handoff.js";
import { createSpawnLintCollector } from "./lint-collect.js";
import { renderReportHtml } from "./render-html.js";
import { renderReportMarkdown } from "./render-markdown.js";

export interface ReportCommandOptions {
  format?: "html" | "md" | "both";
  out?: string;
  handoff?: boolean;
  handoffOut?: string;
  cwd?: string;
}

export async function reportCommand(
  options: ReportCommandOptions = {},
): Promise<{ markdownPath: string; htmlPath: string; handoffPath?: string }> {
  const workspaceRoot = options.cwd ?? getProjectRoot();
  const loaded = await loadManifest(workspaceRoot);
  if (!loaded.success) {
    throw new Error(`Failed to load manifest: ${loaded.error.message}`);
  }

  const report = buildEngagementReport({
    workspaceRoot,
    manifest: loaded.value,
    git: createGitReader(workspaceRoot),
    lint: createSpawnLintCollector(workspaceRoot),
  });

  const outDir = path.resolve(workspaceRoot, options.out ?? ".");
  mkdirSync(outDir, { recursive: true });

  const format = options.format ?? "both";
  const markdownPath = path.join(outDir, "hexagen-report.md");
  const htmlPath = path.join(outDir, "hexagen-report.html");

  if (format === "md" || format === "both") {
    writeFileSync(markdownPath, renderReportMarkdown(report), "utf8");
  }
  if (format === "html" || format === "both") {
    writeFileSync(htmlPath, renderReportHtml(report), "utf8");
  }

  let handoffPath: string | undefined;
  if (options.handoff) {
    handoffPath = path.resolve(
      workspaceRoot,
      options.handoffOut ?? path.join(outDir, "hexagen-handoff.zip"),
    );
    mkdirSync(path.dirname(handoffPath), { recursive: true });
    writeFileSync(handoffPath, buildHandoffZip(report, workspaceRoot));
  }

  return { markdownPath, htmlPath, handoffPath };
}

export async function runReportCommand(
  options: ReportCommandOptions,
): Promise<void> {
  try {
    const written = await reportCommand(options);
    if (options.format !== "html") {
      console.log(`Wrote ${written.markdownPath}`);
    }
    if (options.format !== "md") {
      console.log(`Wrote ${written.htmlPath}`);
    }
    if (written.handoffPath) {
      console.log(`Wrote ${written.handoffPath}`);
    }
  } catch (error) {
    console.error(
      `hexagen report failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
