/**
 * Containment policy for the file keys the generator, the add-on materializer
 * and the notices sidecar produce.
 *
 * This is *policy*, so it lives with the use case's layer rather than in the
 * workspace adapter: "an add-on may only place files inside the project it is
 * generating" is a rule about generation, not a capability of a filesystem. An
 * adapter still defends itself (the temp-dir adapter also refuses to write
 * through a symlink — a hazard only a real filesystem has), but no
 * implementation of `ProjectWorkspacePort` may be trusted to be strict enough,
 * so the escaping key is rejected before it is ever handed over.
 *
 * Written as pure segment arithmetic on purpose: `node:path` is banned in the
 * domain and application layers by the arch-linter's `node-builtin-in-layer`
 * rule, and importing it here would simply relocate HEX-002.
 */

/**
 * Normalize a project-relative file key into workspace path segments, or return
 * `null` when the key does not name a file inside the project.
 *
 * Keys are posix and emitter-produced (`src/feature.ts`,
 * `.github/workflows/sync-integrity.yml`). The normalization reproduces the
 * `path.join(root, key)` + `path.relative(root, dest)` guard this replaced,
 * including its two quirks — a leading `/` is absorbed into the root rather
 * than treated as an absolute path, and `.` / empty / duplicated separators
 * collapse — so the destination is unchanged key for key.
 *
 * Rejected: any key that walks above the root (`../x`, `src/../../x`), and any
 * key that normalizes to the root itself (there is no file to write). A `\` in
 * a segment is also rejected rather than guessed at: on posix it is a legal
 * filename character and on Windows it is a separator, and no emitter produces
 * one, so refusing beats reinterpreting.
 */
export function toWorkspaceSegments(key: string): readonly string[] | null {
  const segments: string[] = [];

  for (const raw of key.split("/")) {
    if (raw === "" || raw === ".") continue;
    if (raw.includes("\\")) return null;
    if (raw === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(raw);
  }

  return segments.length > 0 ? segments : null;
}
