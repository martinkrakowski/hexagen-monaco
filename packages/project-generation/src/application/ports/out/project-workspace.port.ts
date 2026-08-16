/**
 * Driven (outbound) port for the scratch area a single generation run needs
 * (HEX-002).
 *
 * `GenerateProjectUseCase` used to import `node:fs/promises` and `node:path`
 * directly, so generation could not be exercised — or reasoned about — without
 * a real filesystem. This port is derived from what the use case actually
 * consumes, which is a much smaller surface than a filesystem:
 *
 *  1. somewhere for the generator and the exporter to meet ({@link
 *     ProjectWorkspace.reference});
 *  2. "put this text at this place in the project"
 *     ({@link ProjectWorkspace.writeText});
 *  3. "give me back the archive the exporter produced"
 *     ({@link ProjectWorkspace.readBytes});
 *  4. "I am done with it" ({@link ProjectWorkspace.release}).
 *
 * **Mirror test — could a different implementation satisfy this?** Yes, and
 * the package ships one: the test double is a `Map<string, string>` with a
 * `memory://workspace-1` reference and no filesystem behind it at all. A tar
 * stream builder or an object-store prefix would fit equally well. Nothing
 * here names a directory, a file mode, a descriptor, a separator, `mkdir`,
 * `realpath`, `lstat` or `rm`: parent creation is whatever containment the
 * implementation needs (an in-memory map needs none), and `release` is
 * lifecycle, not `fs.rm`. The asymmetry is another tell that this is not an
 * `node:fs` mirror — the use case only ever *writes* text and only ever
 * *reads* bytes, so that is all the port offers.
 *
 * Deliberately NOT a shared `FileSystemPort`: the review's ADR-C1 disposition
 * is explicit that HEX-002 must not be satisfied by inventing a kitchen-sink
 * filesystem port, and the two existing `FileSystemPort` declarations
 * (`project-configuration`, `sync`) are not substitutable for this anyway.
 */

/**
 * One generation run's workspace. Obtained from {@link ProjectWorkspacePort},
 * used for the length of a single `execute`, then released.
 */
export interface ProjectWorkspace {
  /**
   * Opaque handle identifying this workspace to the collaborators that share
   * it — {@link ExternalProjectGeneratorPort.generateAt} and
   * {@link ProjectExporterPort.export} both receive it verbatim.
   *
   * The application layer never parses, joins or otherwise interprets it: only
   * an adapter wired against the same workspace implementation knows what it
   * means (a temp directory path for the filesystem adapter, a
   * `memory://…` token for the in-memory double).
   */
  readonly reference: string;

  /**
   * Place `content` at `path` inside the workspace, creating whatever
   * containment the implementation needs and replacing any existing entry.
   *
   * `path` is a list of name segments (`["src", "feature.ts"]`), never a joined
   * string, so path syntax stays out of the contract entirely. Segments are
   * already known to be contained (see `toWorkspaceSegments`); an
   * implementation may still refuse a write it cannot make safely.
   */
  writeText(path: readonly string[], content: string): Promise<void>;

  /**
   * Read back an artifact produced inside the workspace by a collaborator —
   * the archive the exporter drops there. Resolves `undefined` when the entry
   * does not exist; other failures reject.
   */
  readBytes(path: readonly string[]): Promise<Uint8Array | undefined>;

  /**
   * Release the workspace and everything in it. Called exactly once, from the
   * use case's `finally`. Best effort: implementations should not reject.
   */
  release(): Promise<void>;
}

/** Allocates a fresh, empty {@link ProjectWorkspace} per generation run. */
export interface ProjectWorkspacePort {
  /**
   * Allocate a workspace, or reject having left nothing allocated.
   *
   * All-or-nothing on purpose: a rejected `open()` hands the caller no
   * workspace, so there is nothing for the use case's `finally` to
   * {@link ProjectWorkspace.release}. An implementation that acquires a
   * resource and then fails part-way must therefore roll that acquisition back
   * itself before rejecting — otherwise every failed attempt leaks.
   */
  open(): Promise<ProjectWorkspace>;
}
