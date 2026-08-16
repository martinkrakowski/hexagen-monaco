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
 * than treated as an absolute path, and `.` / interior empty / duplicated
 * separators collapse — so every key the old guard wrote lands in exactly the
 * same place.
 *
 * Rejected: any key that walks above the root (`../x`, `src/../../x`), and any
 * key that does not name a file — one that normalizes to the root itself, or
 * one that ends in a separator (`src/feature.ts/` names a directory). Both of
 * those the old guard also refused to write, just later and less legibly: they
 * reached `writeFile` and came back as a bare EISDIR/ENOTDIR errno naming
 * nothing. Failing here instead names the offending key. A `\` in a segment is
 * likewise rejected rather than guessed at: on posix it is a legal filename
 * character and on Windows it is a separator, and no emitter produces one, so
 * refusing beats reinterpreting.
 */
export function toWorkspaceSegments(key: string): readonly string[] | null {
  // A trailing separator is a malformed file key, not noise to be tidied away:
  // silently rewriting `src/feature.ts/` to `src/feature.ts` would turn an
  // emitter bug into a successful write to a path the emitter never asked for.
  if (key.endsWith("/")) return null;

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
