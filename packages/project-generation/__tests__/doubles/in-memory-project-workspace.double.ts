import type {
  ProjectWorkspace,
  ProjectWorkspacePort,
} from "../../src/application/ports/out/project-workspace.port.js";

/**
 * In-memory {@link ProjectWorkspace} — a `Map<string, string>` standing in for
 * the temp directory the production adapter allocates.
 *
 * Its existence is the point of HEX-002: if the use case can be driven to
 * completion against this (no `node:fs`, no temp dir, a `memory://` reference
 * the generator/exporter never resolve), then generation is genuinely behind a
 * driven port rather than bolted to a filesystem.
 *
 * `release()` deliberately KEEPS the recorded entries — a test asserts what the
 * run produced *after* the use case's `finally` has released the workspace. It
 * flips {@link released} and refuses later writes, which is what a leaked
 * write-after-release would look like.
 */
export class InMemoryWorkspaceDouble implements ProjectWorkspace {
  /** Workspace-relative posix path -> text content. */
  readonly entries = new Map<string, string>();
  /** Binary entries a test seeds to stand in for exporter-produced artifacts. */
  readonly artifacts = new Map<string, Uint8Array>();
  released = false;
  /** Every path written, in call order (duplicates included). */
  readonly writeLog: string[] = [];

  constructor(readonly reference: string) {}

  async writeText(path: readonly string[], content: string): Promise<void> {
    if (this.released) {
      throw new Error(`write after release: ${path.join("/")}`);
    }
    this.writeLog.push(path.join("/"));
    this.entries.set(path.join("/"), content);
  }

  async readBytes(path: readonly string[]): Promise<Uint8Array | undefined> {
    const key = path.join("/");
    const artifact = this.artifacts.get(key);
    if (artifact) return artifact;
    const text = this.entries.get(key);
    return text === undefined ? undefined : new TextEncoder().encode(text);
  }

  async release(): Promise<void> {
    this.released = true;
  }
}

/**
 * {@link ProjectWorkspacePort} double handing out {@link InMemoryWorkspaceDouble}s.
 *
 * `seedArtifacts` is applied to each opened workspace, standing in for what an
 * exporter writes into the workspace out-of-band (the ZIP the archive exporter
 * drops at `project.zip`, which the use case reads back).
 */
export class InMemoryProjectWorkspacePortDouble implements ProjectWorkspacePort {
  private counter = 0;
  readonly opened: InMemoryWorkspaceDouble[] = [];
  readonly seedArtifacts = new Map<string, Uint8Array>();

  async open(): Promise<ProjectWorkspace> {
    this.counter += 1;
    const workspace = new InMemoryWorkspaceDouble(
      `memory://workspace-${this.counter}`,
    );
    for (const [key, bytes] of this.seedArtifacts) {
      workspace.artifacts.set(key, bytes);
    }
    this.opened.push(workspace);
    return workspace;
  }

  /** The workspace opened by the most recent run. Throws if there was none. */
  get last(): InMemoryWorkspaceDouble {
    const workspace = this.opened.at(-1);
    if (!workspace) throw new Error("no workspace was opened");
    return workspace;
  }
}
