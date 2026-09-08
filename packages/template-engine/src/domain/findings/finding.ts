/**
 * The closed shape of a finding (F-D4).
 *
 * A finding is a version-scoped record of a defect that belongs to the
 * generator, not to the project that found it. The front matter is a closed
 * set of flat scalar keys and every enumerable field is a closed vocabulary,
 * so the record is structurally incapable of carrying a project name, a client
 * name, a downstream path, or downstream source — the validator refuses any
 * other key, and the strict parser makes a nested or multi-line value
 * unrepresentable in the first place.
 */

export type FindingSubjectKind = "template" | "component";
export const FINDING_SUBJECT_KINDS: readonly FindingSubjectKind[] = [
  "template",
  "component",
];

export type FindingSeverity = "critical" | "high" | "medium" | "low";
export const FINDING_SEVERITIES: readonly FindingSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
];

export type FindingSurface =
  | "ci"
  | "build"
  | "lint"
  | "test"
  | "runtime"
  | "docs"
  | "dx";
export const FINDING_SURFACES: readonly FindingSurface[] = [
  "ci",
  "build",
  "lint",
  "test",
  "runtime",
  "docs",
  "dx",
];

export type FindingStatus = "open" | "fixed" | "wontfix";
export const FINDING_STATUSES: readonly FindingStatus[] = [
  "open",
  "fixed",
  "wontfix",
];

/**
 * Why the defect happened. Closed vocabulary, decided at G2 from the three seed
 * findings (plan §0):
 * - `host-assumption`  — a capability assumed of the host that the actual
 *   environment lacks (the zsh/ubuntu-latest finding);
 * - `coverage-gap`     — an authoritative check covers less than the material
 *   it backs claims to (the arch-linter layer-rules finding);
 * - `unbounded-growth` — an artifact grows without bound and its size becomes
 *   an input cost (the session-log finding).
 */
export type FindingClass =
  | "host-assumption"
  | "coverage-gap"
  | "unbounded-growth";
export const FINDING_CLASSES: readonly FindingClass[] = [
  "host-assumption",
  "coverage-gap",
  "unbounded-growth",
];

/**
 * The closed set of front-matter keys (F-D4, §2). `fixedIn` is nullable; every
 * other key must carry a value.
 */
export const FINDING_FRONT_MATTER_KEYS: readonly string[] = [
  "id",
  "subject",
  "subjectKind",
  "subjectVersion",
  "fixedIn",
  "class",
  "severity",
  "surface",
  "status",
];

export interface Finding {
  /** Zero-padded sequence number, e.g. "0001". */
  id: string;
  /** Subject id this finding is about — a template id or a component id. */
  subject: string;
  subjectKind: FindingSubjectKind;
  /** Version of the subject the finding was made against (F-D6 join key). */
  subjectVersion: string;
  /** Version that carried the fix; null while the finding is open. */
  fixedIn: string | null;
  class: FindingClass;
  severity: FindingSeverity;
  surface: FindingSurface;
  status: FindingStatus;
  /** The synthetic repro and the fix, after the front-matter fence. */
  body: string;
}
