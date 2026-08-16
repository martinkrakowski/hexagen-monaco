import fs from "node:fs/promises";
import path from "node:path";
import type {
  ProjectWorkspace,
  ProjectWorkspacePort,
} from "../../application/ports/out/project-workspace.port.js";

/**
 * Root the run directories are allocated under. Kept as the literal `/tmp` the
 * use case used before HEX-002 rather than `os.tmpdir()`: on macOS the latter
 * is a per-user `/var/folders/...` path, so switching would change where a
 * generation actually happens. Deliberately unchanged.
 */
const WORKSPACE_ROOT = "/tmp";

/**
 * Filesystem implementation of {@link ProjectWorkspacePort}: each run gets its
 * own directory under {@link WORKSPACE_ROOT}, which the sync engine generates
 * into, the exporter reads from, and `release` removes.
 *
 * Everything genuinely filesystem-shaped lives here — directory naming, parent
 * creation, and the symlink defence a `Map`-backed workspace has no need for.
 * The containment *policy* (an add-on may not escape the project) stays in the
 * application layer, which rejects an escaping key before it reaches any
 * implementation.
 */
export class ScratchDirProjectWorkspaceAdapter implements ProjectWorkspacePort {
  async open(): Promise<ProjectWorkspace> {
    const root = path.join(
      WORKSPACE_ROOT,
      `hexagen-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    );
    // The sync engine mkdirs the target itself, but creating it up front is
    // what makes the workspace a real thing to hand out — and makes the
    // realpath below (the anchor for the symlink guard) resolvable.
    await fs.mkdir(root, { recursive: true });
    return new ScratchDirProjectWorkspace(root, await fs.realpath(root));
  }
}

class ScratchDirProjectWorkspace implements ProjectWorkspace {
  constructor(
    readonly reference: string,
    /** `reference` with symlinks resolved — the anchor every write is checked against. */
    private readonly realRoot: string,
  ) {}

  async writeText(segments: readonly string[], content: string): Promise<void> {
    const dest = path.join(this.reference, ...segments);
    const parent = path.dirname(dest);
    await fs.mkdir(parent, { recursive: true });

    // Symlink guard: the caller's lexical containment check cannot see
    // symlinks. Verify the real parent stays under the workspace root, and
    // never write through a symlinked target — so a symlink planted inside the
    // workspace cannot redirect the write out of it.
    const realParent = await fs.realpath(parent);
    if (
      realParent !== this.realRoot &&
      !realParent.startsWith(this.realRoot + path.sep)
    ) {
      throw new Error(
        `Workspace file path escapes project root via symlink: ${segments.join("/")}`,
      );
    }
    const existing = await fs.lstat(dest).catch(() => null);
    if (existing?.isSymbolicLink()) {
      throw new Error(
        `Workspace file target is a symlink: ${segments.join("/")}`,
      );
    }

    await fs.writeFile(dest, content, "utf-8");
  }

  async readBytes(
    segments: readonly string[],
  ): Promise<Uint8Array | undefined> {
    try {
      return await fs.readFile(path.join(this.reference, ...segments));
    } catch (err) {
      // Absent is a normal answer (an export that streamed instead of writing
      // an archive); anything else is a real failure and stays visible.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  }

  async release(): Promise<void> {
    try {
      await fs.rm(this.reference, { recursive: true, force: true });
    } catch {
      // Best effort cleanup — a temp dir that outlives the run is not a
      // reason to fail a generation that otherwise succeeded.
    }
  }
}
