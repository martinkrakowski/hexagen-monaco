/**
 * Outbound ports for the governance API family (HEX-016, structural half).
 *
 * `governance/refresh` used to own four I/O concerns inline: it `exec`'d
 * `yarn lint:arch` through a shell, wrote and unlinked a temp manifest, parsed
 * YAML, and `new`'d `ServerLLMAdapter` + `GenerateSuggestionUseCase`. Item 1.6
 * (PR #444) took the YAML half: every manifest parse in this family now goes
 * through the pure `analyzeManifest` function in `./manifest-analysis`. This
 * module takes the other two — subprocess/filesystem and LLM — and puts them
 * behind ports whose adapters live in `./adapters` and are constructed in the
 * composition root (`app/lib/wire.server.ts`).
 *
 * NOTE (no YAML port, deliberately). The review's HEX-016 lists "YAML parsing"
 * as a fourth concern, but the audit adjudicated the sibling finding HEX-026 —
 * the same `js-yaml` question, one layer down — as *refuted*: "js-yaml here is
 * pure in-memory string parsing — same class as the Zod the file already uses …
 * Fix: document the exception; no codec port." Parsing a string the caller
 * already holds is a pure function, not I/O: it touches no process, no socket
 * and no disk, and a fake would only ever be a worse YAML parser. It is
 * therefore isolated as a function (`analyzeManifest`) rather than injected as
 * a port. This is that documented exception.
 *
 * ## Why the outcomes are unions rather than `Result` / thrown errors
 *
 * Both ports have THREE outcomes, not two, and collapsing the third is the
 * defect this file exists to remove:
 *
 *   - the linter ran and the manifest is clean;
 *   - the linter ran and reported violations;
 *   - **the linter could not run at all** (not built, `yarn` absent from the
 *     production image, FATAL missing manifest, 30s timeout).
 *
 * The old route mapped the third case onto the second: every line of the failed
 * subprocess's stderr — including `/bin/sh: yarn: not found` and the linter's
 * own `FATAL ERROR:` banner — became a `type: "error", severity: "HIGH"`
 * architectural violation in the governance panel. That is the mirror image of
 * the false-green AUD-005 killed on the status path: a toolchain outage
 * rendered as an architectural verdict. Same story for suggestions, where a
 * missing API key or a 503 from the provider was returned as `suggestions: []`
 * — indistinguishable from "the LLM ran and had nothing to say".
 *
 * A `Result<T, Error>` would not have prevented either: callers routinely map
 * an error arm to an empty list. Naming `unavailable` as a value the response
 * mapper must destructure is what makes the third case impossible to drop
 * silently.
 */

/** One architectural violation, as the governance UI consumes it. */
export interface Violation {
  id: string;
  type: "error" | "warning" | "info";
  message: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
}

/** One AI suggestion, as the governance UI consumes it. */
export interface AISuggestion {
  id: string;
  message: string;
  confidence: number;
  category:
    | "context-split"
    | "port-definition"
    | "dependency-cleanup"
    | "general";
}

/**
 * The result of linting a candidate manifest.
 *
 * `unavailable` is NOT an error arm to be swallowed — it means the verdict is
 * unknown, and callers must render it as such. Only `clean` may be presented as
 * a passing architecture.
 */
export type ManifestLintOutcome =
  | { kind: "clean" }
  | { kind: "violations"; messages: string[] }
  | { kind: "unavailable"; reason: string };

/**
 * Lint a manifest supplied as YAML text.
 *
 * The contract is deliberately "here is the manifest source", not "here is a
 * path": the temp file the CLI linter needs is an implementation detail of the
 * adapter, which is the whole reason the route no longer imports `fs`.
 *
 * Distinct from `@hexagen/transaction-system`'s `LintValidationPort`, which
 * validates the repository's own committed manifest during the accept/reject
 * saga (and whose wired adapter explicitly ignores its path argument). This one
 * lints an unsaved candidate the caller is still editing.
 */
export interface ManifestLintPort {
  lintManifest(manifestYaml: string): Promise<ManifestLintOutcome>;
}

/**
 * The result of asking for architectural suggestions.
 *
 * `unavailable` covers both "no API key is configured" and "the provider
 * failed" — in neither case did a model look at the manifest, so neither may be
 * reported as an empty suggestion list.
 */
export type SuggestionOutcome =
  | { kind: "suggestions"; suggestions: AISuggestion[] }
  | { kind: "unavailable"; reason: string };

export interface SuggestionRequest {
  manifestYaml: string;
  openFileContent?: string;
}

export interface SuggestionPort {
  suggest(request: SuggestionRequest): Promise<SuggestionOutcome>;
}
