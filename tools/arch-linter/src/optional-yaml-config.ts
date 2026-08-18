/**
 * Optional-config loading for the linter's invariants files (GOD-002 split).
 *
 * `layer-rules.yaml` and `linter-config.yaml` are genuinely OPTIONAL: a project
 * that declares neither is still linted, against built-in defaults. That
 * fallback is legitimate only for a file that is truly ABSENT.
 *
 * A file that EXISTS but cannot be read or parsed must be fatal. Defaulting
 * there silently disables every rule the file declares — the `cannot_import`
 * denials, the subpath conventions, the layer allow-lists — and the run then
 * prints "Architecture is compliant". That is a green gate that verified
 * nothing: the same failure class as AUD-010, where a linter that never ran
 * was indistinguishable from a linter that passed.
 *
 * This module only CLASSIFIES the outcome. It never logs, never touches
 * `process`, and takes its reader as a parameter (the same injection shape as
 * `checkMissingMarker`). That is what makes the policy unit-testable without
 * spawning the CLI — the whole point of splitting the bootstrap out of the
 * library barrel.
 */
import * as yaml from "js-yaml";

/**
 * The three outcomes of loading an optional config, kept distinct so the caller
 * cannot collapse "absent" and "broken" back into one branch by accident.
 *
 * - `loaded`  — parsed to a mapping (an empty file yields an empty config).
 * - `missing` — the file does not exist; defaults are correct.
 * - `invalid` — the file exists and could not be consulted; the caller MUST
 *   fail closed rather than substitute defaults.
 */
export type OptionalYamlConfig<T> =
  | { kind: "loaded"; value: T }
  | { kind: "missing" }
  | { kind: "invalid"; reason: string };

function messageOf(e: unknown): string {
  return e instanceof Error && e.message ? e.message : String(e);
}

/**
 * Read and parse an optional YAML config, distinguishing "absent" from "broken".
 *
 * `ENOENT` is the ONLY signal treated as absent. Every other read failure
 * (`EACCES`, `EISDIR`, `ELOOP`, …) means the file is there and we could not
 * consult it, which is not the same as a project that declared no rules.
 */
export async function loadOptionalYamlConfig<T>(
  filePath: string,
  readFile: (path: string) => Promise<string>,
  parse?: (value: unknown) => T,
): Promise<OptionalYamlConfig<T>> {
  let contents: string;
  try {
    contents = await readFile(filePath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return { kind: "missing" };
    }
    return { kind: "invalid", reason: messageOf(e) };
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(contents);
  } catch (e) {
    return { kind: "invalid", reason: messageOf(e) };
  }

  // An empty file — or one holding an explicit `null`/`~` — parses cleanly and
  // means "no rules declared". It keeps loading as the empty config, exactly as
  // it did before this guard existed.
  if (parsed === null || parsed === undefined) {
    return { kind: "loaded", value: {} as T };
  }

  // A document that parses to a non-mapping (a scalar, a sequence) cannot carry
  // the keys the linter reads. Left alone it would flow through the old `?? {}`
  // and disable the rules exactly as quietly as a parse error does, so it is
  // classified the same way.
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      kind: "invalid",
      reason: `expected a YAML mapping, got ${
        Array.isArray(parsed) ? "a sequence" : typeof parsed
      }`,
    };
  }

  if (parse) {
    try {
      return { kind: "loaded", value: parse(parsed) };
    } catch (e) {
      return { kind: "invalid", reason: messageOf(e) };
    }
  }

  return { kind: "loaded", value: parsed as T };
}
