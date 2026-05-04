import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export async function withTempWorkspace<T extends Record<string, string>>(
  fn: (ctx: { workspaceRoot: string } & T) => Promise<void>,
  extras?: (workspaceRoot: string) => T,
): Promise<void> {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "hexagen-test-"),
  );
  try {
    const ctx = extras
      ? { workspaceRoot, ...extras(workspaceRoot) }
      : { workspaceRoot };
    await fn(ctx as { workspaceRoot: string } & T);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

export async function makeTmpWorkspace(
  prefix = "hexagen-fs-utils-test-",
): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

export async function readText(p: string): Promise<string> {
  return fs.readFile(p, "utf8");
}

export async function readJson(
  filePath: string,
): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}
