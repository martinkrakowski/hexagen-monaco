import * as path from "node:path";
import * as fs from "node:fs";
import type { LinterConfig, MarkerExclusion } from "./subpath-violation.js";

export interface UnexpectedMarkerViolation {
  type: "unexpected-server-marker";
  enforcement: "error" | "warn";
  filePath: string;
  message: string;
}

export interface MissingMarkerViolation {
  type: "missing-server-marker";
  enforcement: "error" | "warn";
  filePath: string;
  message: string;
}

export interface BrokenServerExportViolation {
  type: "broken-server-export";
  enforcement: "error";
  filePath: string;
  message: string;
}

export type ServerMarkerViolation =
  | UnexpectedMarkerViolation
  | MissingMarkerViolation
  | BrokenServerExportViolation;

export function hasServerOnlyMarker(fileText: string): boolean {
  for (const line of fileText.split("\n")) {
    const trimmed = line.trim();

    if (
      trimmed &&
      !trimmed.startsWith("//") &&
      !trimmed.startsWith("*") &&
      !trimmed.startsWith("/*")
    ) {
      break;
    }

    if (/@hexagen-server-only\b/.test(line)) {
      return true;
    }
  }
  return false;
}

export function checkUnexpectedMarker(
  filePath: string,
  fileText: string,
  config: LinterConfig,
): UnexpectedMarkerViolation | null {
  if (!config.subpath_conventions?.server?.require_marker) return null;
  if (!hasServerOnlyMarker(fileText)) return null;
  if (
    filePath.endsWith("/src/server.ts") ||
    filePath.endsWith("\\src\\server.ts")
  )
    return null;

  return {
    type: "unexpected-server-marker",
    enforcement: config.subpath_conventions.server.enforcement,
    filePath,
    message: `@hexagen-server-only marker found in non-server barrel (${filePath}). This marker should only appear in src/server.ts files.`,
  };
}

function distToSource(distPath: string): string {
  return distPath
    .replace("./dist/", "./src/")
    .replace(".d.ts", ".ts")
    .replace(".js", ".ts")
    .replace(".cjs", ".ts")
    .replace(".mjs", ".ts");
}

export function resolveServerBarrelPath(
  packageDir: string,
  serverExport: unknown,
  fileExists: (p: string) => boolean = fs.existsSync,
): string | null {
  if (typeof serverExport === "string") {
    const sourcePath = distToSource(serverExport);
    const absolutePath = path.join(packageDir, sourcePath);
    return fileExists(absolutePath) ? absolutePath : null;
  }

  if (typeof serverExport === "object" && serverExport !== null) {
    const cond = serverExport as Record<string, unknown>;
    const typesPath = cond.types || cond.import;

    if (typeof typesPath === "string") {
      const sourcePath = distToSource(typesPath);
      const absolutePath = path.join(packageDir, sourcePath);
      return fileExists(absolutePath) ? absolutePath : null;
    }
  }

  return null;
}

export function checkMissingMarker(
  packageDir: string,
  packageName: string,
  packageExports: Record<string, unknown>,
  config: LinterConfig,
  readFile: (filePath: string) => string,
  fileExists: (p: string) => boolean = fs.existsSync,
): MissingMarkerViolation | BrokenServerExportViolation | null {
  if (!config.subpath_conventions?.server?.require_marker) return null;

  if (!Object.prototype.hasOwnProperty.call(packageExports, "./server")) {
    return null;
  }
  const serverExport = packageExports["./server"];

  const exclusions: MarkerExclusion[] =
    config.subpath_conventions.server.marker_exclusions ?? [];
  if (exclusions.some((ex: MarkerExclusion) => ex.package === packageName)) {
    return null;
  }

  const serverBarrelPath = resolveServerBarrelPath(
    packageDir,
    serverExport,
    fileExists,
  );
  if (!serverBarrelPath) {
    return {
      type: "broken-server-export",
      enforcement: "error",
      filePath: path.join(packageDir, "package.json"),
      message: `Package declares ./server export but source file cannot be resolved. Check exports field mapping.`,
    };
  }

  const fileText = readFile(serverBarrelPath);
  if (hasServerOnlyMarker(fileText)) return null;

  return {
    type: "missing-server-marker",
    enforcement: config.subpath_conventions.server.enforcement,
    filePath: serverBarrelPath,
    message: `Server barrel missing @hexagen-server-only marker at start of file, before any imports.`,
  };
}
