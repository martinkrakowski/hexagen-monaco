import { randomBytes } from "node:crypto";
import { realpath as realpathCallback } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ProposalMeta, Slice, type Result } from "@hexagen/shared";
import {
  SidecarFileExistsError,
  writeFileExclusive,
} from "@hexagen/shared/node/sidecar-write";
import type {
  OnDiskPath,
  ProposalWorkspacePort,
} from "../../application/ports/out/proposal-workspace.port.js";

/**
 * The OS's own realpath (`realpath(3)`), which on a case-insensitive volume
 * reports the spelling stored on disk; the JS `fs.promises.realpath` does not.
 */
const realpathNative = promisify(realpathCallback.native);

const PROPOSALS_DIR = [".hexagen", "proposals"];
const ID_PATTERN = /^[0-9a-f]{24}$/;

function fail<T>(error: unknown): Result<T, Error> {
  return {
    success: false,
    error: error instanceof Error ? error : new Error(String(error)),
  };
}

/**
 * The working tree under `workspaceRoot`, for `hexagen_propose_patch`. It
 * reads the slice and resolves real paths; its only writes are the two files
 * of a proposal under `<root>/.hexagen/proposals/`, each written exclusively
 * (temp file, then link: never overwritten) under a random hex id.
 */
export class ProposalWorkspaceAdapter implements ProposalWorkspacePort {
  constructor(private readonly workspaceRoot: string) {}

  async readSlice(): Promise<Result<Slice, Error>> {
    const file = path.join(this.workspaceRoot, ".hexagen", "slice.json");
    try {
      const parsed = Slice.safeParse(
        JSON.parse(await fs.readFile(file, "utf-8")),
      );
      if (!parsed.success) {
        return fail(new Error(".hexagen/slice.json is not a valid slice"));
      }
      return { success: true, value: parsed.data };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return fail(
        new Error(
          code === "ENOENT"
            ? ".hexagen/slice.json does not exist"
            : ".hexagen/slice.json could not be read",
        ),
      );
    }
  }

  async resolveOnDisk(
    paths: readonly string[],
  ): Promise<Result<readonly OnDiskPath[], Error>> {
    try {
      const realRoot = await realpathNative(this.workspaceRoot);
      const out: OnDiskPath[] = [];
      for (const p of paths) out.push(await this.resolveOne(realRoot, p));
      return { success: true, value: out };
    } catch (error) {
      return fail(error);
    }
  }

  private async resolveOne(realRoot: string, p: string): Promise<OnDiskPath> {
    let current = path.join(realRoot, ...p.split("/"));
    const tail: string[] = [];
    for (;;) {
      try {
        const real = await realpathNative(current);
        const full = path.join(real, ...tail);
        const rel = path.relative(realRoot, full);
        if (
          rel === "" ||
          rel === ".." ||
          rel.startsWith(`..${path.sep}`) ||
          path.isAbsolute(rel)
        ) {
          return { path: p, problem: "resolves outside the repository" };
        }
        return { path: p, real: rel.split(path.sep).join("/") };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ELOOP") {
          return { path: p, problem: "symlink loop" };
        }
        if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      }
      // A link that exists but resolves to nothing is a dangling symlink.
      const exists = await fs.lstat(current).then(
        () => true,
        () => false,
      );
      if (exists) return { path: p, problem: "dangling symlink" };
      const parent = path.dirname(current);
      if (parent === current) {
        return { path: p, problem: "no existing parent directory" };
      }
      tail.unshift(path.basename(current));
      current = parent;
    }
  }

  private async proposalsDir(): Promise<string> {
    const dir = path.join(this.workspaceRoot, ...PROPOSALS_DIR);
    await fs.mkdir(dir, { recursive: true });
    const realRoot = await realpathNative(this.workspaceRoot);
    const realDir = await realpathNative(dir);
    const rel = path.relative(realRoot, realDir);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(".hexagen/proposals resolves outside the repository");
    }
    return dir;
  }

  async savePatch(patch: string): Promise<Result<{ id: string }, Error>> {
    try {
      const dir = await this.proposalsDir();
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = randomBytes(12).toString("hex");
        try {
          await writeFileExclusive(path.join(dir, `${id}.patch`), patch);
          return { success: true, value: { id } };
        } catch (error) {
          if (error instanceof SidecarFileExistsError) continue;
          throw error;
        }
      }
      throw new Error("could not pick an unused proposal id");
    } catch (error) {
      return fail(error);
    }
  }

  async saveMeta(meta: ProposalMeta): Promise<Result<void, Error>> {
    try {
      if (!ID_PATTERN.test(meta.id)) throw new Error("unsafe proposal id");
      const checked = ProposalMeta.parse(meta);
      const dir = await this.proposalsDir();
      await writeFileExclusive(
        path.join(dir, `${meta.id}.json`),
        `${JSON.stringify(checked, null, 2)}\n`,
      );
      return { success: true, value: undefined };
    } catch (error) {
      return fail(error);
    }
  }

  async discardPatch(id: string): Promise<void> {
    if (!ID_PATTERN.test(id)) return;
    await fs
      .unlink(path.join(this.workspaceRoot, ...PROPOSALS_DIR, `${id}.patch`))
      .catch(() => undefined);
  }
}
