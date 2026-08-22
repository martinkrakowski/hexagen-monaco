/**
 * S4 — the rules that decide whether a manifest draft is safe to write.
 *
 * WHY VALIDATION LIVES ON THIS SCREEN AND NOT DOWNSTREAM. The draft this
 * module guards is what gets WRITTEN. A user who accepts a system with no name,
 * two contexts called `orders`, or a `depends_on` edge pointing at a context
 * they excluded ships all three into their repository's `manifest.yaml` and
 * finds out from `hexagen-lint`, days later, in someone else's PR. The API
 * route re-checks nothing it cannot see, and `hexagen bootstrap` only refuses
 * one of these cases (zero contexts) — by then the run has already started.
 *
 * WHAT THIS MODULE DOES NOT DO. It does not rewrite the draft to make it valid.
 * Every finding is returned for the screen to show; the only value it normalises
 * is whitespace, and only in the payload it hands to the API. Silently
 * "correcting" a name the user typed is how a ratification screen stops being a
 * ratification screen.
 *
 * Pure functions over plain data: no React, no DOM, no `"use client"`, no fetch.
 */
import type { BoundedContext, Manifest } from "@hexagen/sync";
import { sanitizeScope } from "./scope-preview";
import type {
  BrownfieldLayoutDraft,
  BrownfieldManifestContextDraft,
  BrownfieldManifestDraft,
} from "../BrownfieldFlow/types";

/**
 * `ArchitectureType` in `packages/sync/src/types/manifest/manifest.ts`.
 *
 * Spelled out here rather than imported so the screen can iterate it at runtime
 * (a union has no members to map over), but NOT trusted to stay in step by
 * inspection: `ARCHITECTURE_PARITY` below is a compile-time assertion that this
 * union and the upstream one are mutually assignable, so an arm added or dropped
 * upstream fails `yarn --cwd apps/web typecheck`.
 *
 * The upstream side is reached through `Manifest["architecture"]` — the union
 * itself is not on `@hexagen/sync`'s public barrel, and widening that barrel for
 * a type already reachable from an exported one would be a gratuitous surface
 * commitment. `import type` is erased, so none of this reaches the bundle.
 */
export type ManifestArchitecture =
  | "modular-monolith"
  | "microservices"
  | "monolith";

export const MANIFEST_ARCHITECTURES: readonly ManifestArchitecture[] = [
  "modular-monolith",
  "microservices",
  "monolith",
] as const;

/**
 * `BoundedContextType` from the same file, on the same terms.
 *
 * `hexagen bootstrap` writes `type: core` for every proposed context; the point
 * of this screen is that the user gets to disagree with that, per row.
 */
export type ManifestContextType =
  | "core"
  | "supporting"
  | "generic"
  | "shared-kernel"
  | "driver";

export const MANIFEST_CONTEXT_TYPES: readonly ManifestContextType[] = [
  "core",
  "supporting",
  "generic",
  "shared-kernel",
  "driver",
] as const;

/**
 * Compile-time drift guard for the two unions above.
 *
 * A new upstream arm (say `"serverless"`) makes `Equals` resolve to `false`,
 * `false` does not satisfy `Expect`'s `extends true` constraint, and `tsc` fails
 * naming this file. `Mutual<A extends B, B extends A>` would read better but is
 * a circular constraint (TS2313); the conditional-identity trick below is the
 * formulation that actually compiles.
 *
 * Both aliases are EXPORTED on purpose: `no-unused-vars` treats an unexported,
 * unreferenced type alias as dead code and errors on it, and an assertion of
 * this kind has no runtime referent to point at.
 *
 * `apps/web`'s tsconfig excludes every `.test.ts` and `.test.tsx` file, so this
 * could not live in the test suite — a type assertion there is never checked by
 * anything, because `tsc` never sees the file.
 */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type Expect<T extends true> = T;

export type ARCHITECTURE_PARITY = Expect<
  Equals<ManifestArchitecture, NonNullable<Manifest["architecture"]>>
>;

export type CONTEXT_TYPE_PARITY = Expect<
  Equals<ManifestContextType, NonNullable<BoundedContext["type"]>>
>;

/** What `hexagen bootstrap --yes` proposes, so the screen's default matches it. */
export const DEFAULT_ARCHITECTURE: ManifestArchitecture = "modular-monolith";
export const DEFAULT_CONTEXT_TYPE: ManifestContextType = "core";

/**
 * Seed an S4 draft from what the user ratified on S3.
 *
 * Every context that survived layout ratification starts INCLUDED — S3 is where
 * "is this a bounded context?" was already answered, and re-asking it here with
 * every box unticked would make the previous screen's work look provisional.
 * Everything the CLI would have guessed is left blank instead: `description` is
 * empty rather than `hexagen bootstrap --yes`'s "Candidate context from
 * packages/x", and `dependsOn` is empty because bootstrap infers no edges and
 * this screen must not appear to have inferred any either.
 *
 * `scope` is pre-sanitized, so the preview opens in its "exactly what you typed"
 * state rather than immediately telling the user we rewrote a value they never
 * entered.
 */
export function createManifestDraft(
  layout: BrownfieldLayoutDraft,
  projectName: string,
): BrownfieldManifestDraft {
  return {
    system: projectName.trim(),
    scope: sanitizeScope(projectName),
    architecture: DEFAULT_ARCHITECTURE,
    contexts: layout.contexts.map((context) => ({
      name: context.contextName,
      include: true,
      type: DEFAULT_CONTEXT_TYPE,
      description: "",
      dependsOn: [],
    })),
  };
}

/** Which control a problem belongs to, so the screen can put it next to it. */
export type ManifestDraftFieldId =
  | "system"
  | "scope"
  | "architecture"
  | "contexts";

export interface ManifestDraftProblem {
  /** Stable React key; also what a test asserts on instead of prose. */
  readonly id: string;
  readonly field: ManifestDraftFieldId;
  /** Set when the problem is about one row rather than the whole draft. */
  readonly contextName?: string;
  /** Shown verbatim to the user. Complete sentence, ends with a period. */
  readonly message: string;
}

function isArchitecture(value: string): value is ManifestArchitecture {
  return (MANIFEST_ARCHITECTURES as readonly string[]).includes(value);
}

/** The rows the user ticked. The only rows that reach `manifest.yaml`. */
export function includedContexts(
  draft: BrownfieldManifestDraft,
): readonly BrownfieldManifestContextDraft[] {
  return draft.contexts.filter((context) => context.include);
}

/**
 * Names offered as `depends_on` targets for the row at `index`.
 *
 * INCLUDED rows only, never the row itself, de-duplicated. Offering an excluded
 * context would let the user build an edge `validateManifestDraft` then rejects,
 * and a control whose only outcome is an error is a trap rather than an
 * affordance. The empty result is meaningful and the view renders it as such:
 * a one-context architecture has no edges to draw.
 */
export function dependencyOptionsFor(
  draft: BrownfieldManifestDraft,
  index: number,
): readonly string[] {
  const self = draft.contexts[index]?.name.trim() ?? "";

  const names = includedContexts(draft)
    .map((context) => context.name.trim())
    .filter((name) => name.length > 0 && name !== self);

  return [...new Set(names)];
}

/**
 * Every reason this draft must not be written, in screen order.
 *
 * An empty array is the ratify gate: `ManifestRatify` refuses to advance the
 * state machine while anything is in here.
 */
export function validateManifestDraft(
  draft: BrownfieldManifestDraft,
): readonly ManifestDraftProblem[] {
  const problems: ManifestDraftProblem[] = [];

  if (draft.system.trim().length === 0) {
    problems.push({
      id: "system-empty",
      field: "system",
      message:
        "Give the system a name. It becomes the `system:` key of manifest.yaml and names the architecture everywhere else in the product.",
    });
  }

  if (draft.scope.trim().length === 0) {
    problems.push({
      id: "scope-empty",
      field: "scope",
      message:
        "Give the project an npm scope. Every generated package is published or referenced as `@scope/name`.",
    });
  }

  if (!isArchitecture(draft.architecture)) {
    // Defensive: the screen only offers the three, but the draft also arrives
    // from the draft store (BF-3.4), where an older or hand-edited value can.
    problems.push({
      id: "architecture-unknown",
      field: "architecture",
      message: `"${draft.architecture}" is not an architecture hexagen writes. Pick one of ${MANIFEST_ARCHITECTURES.join(", ")}.`,
    });
  }

  const included = includedContexts(draft);

  if (included.length === 0) {
    // Mirrors the CLI's own refusal, so the two never disagree about the rule:
    // "No contexts were ratified. Nothing was written."
    problems.push({
      id: "contexts-none-included",
      field: "contexts",
      message:
        "Include at least one bounded context. hexagen bootstrap refuses to write a manifest with none, and nothing would be written.",
    });
  }

  const seenNames = new Set<string>();
  const includedNames = new Set(
    included.map((context) => context.name.trim()).filter((n) => n.length > 0),
  );

  for (const context of included) {
    const name = context.name.trim();

    if (name.length === 0) {
      problems.push({
        id: "context-name-empty",
        field: "contexts",
        message:
          "One included context has no name. Name it or untick it — an unnamed `bounded_contexts` entry is not loadable.",
      });
      continue;
    }

    if (seenNames.has(name)) {
      problems.push({
        id: `context-duplicate-${name}`,
        field: "contexts",
        contextName: name,
        message: `Two included contexts are called "${name}". A context name is the identity that depends_on edges resolve against, so it has to be unique.`,
      });
    }
    seenNames.add(name);

    for (const target of context.dependsOn) {
      const trimmedTarget = target.trim();

      if (trimmedTarget === name) {
        problems.push({
          id: `context-self-edge-${name}`,
          field: "contexts",
          contextName: name,
          message: `"${name}" depends on itself. Remove the edge — a context is never its own upstream.`,
        });
        continue;
      }

      if (!includedNames.has(trimmedTarget)) {
        problems.push({
          id: `context-dangling-edge-${name}-${trimmedTarget}`,
          field: "contexts",
          contextName: name,
          message: `"${name}" depends on "${trimmedTarget}", which is not an included context. Include it, or drop the edge.`,
        });
      }
    }
  }

  return problems;
}

/** The `BootstrapAnswers` payload fields, normalised for the wire. */
export interface ManifestRatificationPayload {
  readonly system: string;
  /** Already run through `sanitizeScope`, so it equals what the user was shown. */
  readonly scope: string;
  readonly architecture: string;
  readonly contexts: readonly {
    readonly name: string;
    readonly include: true;
    readonly type: string;
    readonly description: string;
    readonly dependsOn: readonly string[];
  }[];
}

/**
 * Project the draft onto the answers payload BF-4.3's route accepts.
 *
 * Two deliberate choices:
 *
 *  - EXCLUDED ROWS ARE DROPPED, not sent with `include: false`. `emitManifest`
 *    filters them anyway, and sending a row the user unticked invites a later
 *    consumer to "helpfully" resurrect it.
 *  - THE SCOPE IS SENT SANITIZED. `hexagen bootstrap` sanitizes again on the way
 *    into `manifest.yaml`, and `sanitizeScope` is idempotent (pinned by
 *    `scope-preview.test.ts`), so sending the previewed value costs nothing and
 *    guarantees the string the user ratified is the string on the wire.
 *
 * Call only on a draft `validateManifestDraft` returned empty for; it normalises
 * whitespace, it does not repair a draft.
 */
export function toRatificationPayload(
  draft: BrownfieldManifestDraft,
): ManifestRatificationPayload {
  return {
    system: draft.system.trim(),
    scope: sanitizeScope(draft.scope),
    architecture: draft.architecture,
    contexts: includedContexts(draft).map((context) => ({
      name: context.name.trim(),
      include: true as const,
      type: context.type.trim() || DEFAULT_CONTEXT_TYPE,
      description: context.description.trim(),
      dependsOn: context.dependsOn
        .map((target) => target.trim())
        .filter((target) => target.length > 0),
    })),
  };
}

/**
 * Patch one context row, returning a new draft.
 *
 * Addressed by INDEX, not by name. Name is what the user is editing on this
 * screen: a name-keyed update loses the row on the first keystroke that clears
 * the field, and two rows mid-rename can transiently share a key. Index is
 * stable for the lifetime of the draft — rows are never added or removed here,
 * only included or excluded.
 */
export function updateContextAt(
  draft: BrownfieldManifestDraft,
  index: number,
  patch: Partial<BrownfieldManifestContextDraft>,
): BrownfieldManifestDraft {
  if (index < 0 || index >= draft.contexts.length) return draft;

  return {
    ...draft,
    contexts: draft.contexts.map((context, i) =>
      i === index ? { ...context, ...patch } : context,
    ),
  };
}

/** Add or remove one `depends_on` edge on the row at `index`. */
export function toggleDependency(
  draft: BrownfieldManifestDraft,
  index: number,
  target: string,
  shouldDepend: boolean,
): BrownfieldManifestDraft {
  const context = draft.contexts[index];
  if (!context) return draft;

  const without = context.dependsOn.filter((name) => name !== target);

  return updateContextAt(draft, index, {
    // Append rather than sort: the order the user ratified edges in is the
    // order they read back, and `depends_on` is a list in the YAML too.
    dependsOn: shouldDepend ? [...without, target] : without,
  });
}
