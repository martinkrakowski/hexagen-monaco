import type { Result } from "@hexagen/shared";
import {
  FINDING_CLASSES,
  FINDING_FRONT_MATTER_KEYS,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  FINDING_SUBJECT_KINDS,
  FINDING_SURFACES,
  type Finding,
  type FindingSubjectKind,
} from "./finding.js";
import { parseFinding } from "./parse-finding.js";
import { compareSemver, isSemver } from "./semver.js";

/**
 * The validator is the F-D4 security mechanism: the record is sanitised by
 * schema, not by discipline. Every refusal below names the offending field so
 * the author is told what to fix instead of being handed a shape.
 */

export class FindingValidationError extends Error {
  /** The front-matter field the fault is in — or "body" / "front-matter". */
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "FindingValidationError";
    this.field = field;
  }
}

export interface FindingContext {
  /** The subject id of the directory this finding file sits under. */
  subjectId: string;
  /**
   * The kind the file's location implies: a `templates/<id>/findings/`
   * directory is a template subject, a `<component root>/findings/` directory
   * (e.g. `tools/arch-linter/findings/`) is a component subject.
   */
  subjectKind: FindingSubjectKind;
  /** Human-readable location label for error messages. */
  locationLabel: string;
  /**
   * The current version of a known subject from its manifest.json (for
   * components, the caller's equivalent record) — undefined when the subject
   * id is not known at all. A known subject is required to resolve to a
   * version so the "not ahead" check has something to compare against.
   */
  currentVersion(
    subjectKind: FindingSubjectKind,
    subjectId: string,
  ): string | undefined;
  /**
   * Normalized root of the generator for the body absolute-path check (F-D4,
   * §5 risk 3). An empty string means nothing is "inside", so every absolute
   * path in a body is refused.
   */
  generatorRoot: string;
}

export function validateFinding(
  text: string,
  context: FindingContext,
): Result<Finding, FindingValidationError> {
  const parsed = parseFinding(text);
  if (!parsed.success) {
    return {
      success: false,
      error: new FindingValidationError(
        "front-matter",
        `line ${parsed.error.line}: ${parsed.error.message}`,
      ),
    };
  }
  const { frontMatter, body } = parsed.value;

  // 1. Unknown keys — the closed set is the capability: a field a finding may
  //    not carry is refused before any vocabulary check can look at its value.
  for (const key of frontMatter.keys()) {
    if (!FINDING_FRONT_MATTER_KEYS.includes(key)) {
      return reject(
        key,
        `unknown front-matter key '${key}' — the finding schema is closed (F-D4), ` +
          `allowed keys: ${FINDING_FRONT_MATTER_KEYS.join(", ")}`,
      );
    }
  }

  // 2. Presence — every key in the closed set must appear (fixedIn may be null).
  for (const key of FINDING_FRONT_MATTER_KEYS) {
    if (frontMatter.get(key) === undefined) {
      return reject(key, `missing front-matter field '${key}'`);
    }
  }

  const id = frontMatter.get("id") ?? "";
  const subject = frontMatter.get("subject") ?? "";
  const subjectVersion = frontMatter.get("subjectVersion") ?? "";
  // A key present with no value parses to null; `?? null` also folds the
  // impossible "missing" case (refused above) so the type stays `string | null`.
  const fixedIn = frontMatter.get("fixedIn") ?? null;

  if (id === "") return reject("id", "field 'id' must be a non-empty value");
  if (subject === "")
    return reject("subject", "field 'subject' must be a non-empty value");

  // 3. Closed vocabularies — each union from finding.ts, refused by field.
  const subjectKind = enumValue(
    "subjectKind",
    frontMatter.get("subjectKind") ?? null,
    FINDING_SUBJECT_KINDS,
  );
  if (!subjectKind.success) return subjectKind;
  const severity = enumValue(
    "severity",
    frontMatter.get("severity") ?? null,
    FINDING_SEVERITIES,
  );
  if (!severity.success) return severity;
  const surface = enumValue(
    "surface",
    frontMatter.get("surface") ?? null,
    FINDING_SURFACES,
  );
  if (!surface.success) return surface;
  const status = enumValue(
    "status",
    frontMatter.get("status") ?? null,
    FINDING_STATUSES,
  );
  if (!status.success) return status;
  const findingClass = enumValue(
    "class",
    frontMatter.get("class") ?? null,
    FINDING_CLASSES,
  );
  if (!findingClass.success) return findingClass;

  // 4. The subject must be the subject the file sits under — kind first, then
  //    id, then existence. Each refusal names the offending field.
  if (subjectKind.value !== context.subjectKind) {
    return reject(
      "subjectKind",
      `subjectKind '${subjectKind.value}' does not match where the file sits — ` +
        `expected '${context.subjectKind}' under ${context.locationLabel}`,
    );
  }
  const current = context.currentVersion(subjectKind.value, subject);
  if (current === undefined) {
    return reject(
      "subject",
      `unknown subject id '${subject}' (subjectKind: ${subjectKind.value})`,
    );
  }
  if (subject !== context.subjectId) {
    return reject(
      "subject",
      `subject '${subject}' does not match the directory it sits in — ` +
        `expected '${context.subjectId}' under ${context.locationLabel}`,
    );
  }

  // 5. subjectVersion — well-formed semver and not ahead of the subject's
  //    current manifest.json version (§3 G2). "A version no manifest ever
  //    carried" needs git history and is not knowable at validation time.
  if (!isSemver(subjectVersion)) {
    return reject(
      "subjectVersion",
      `subjectVersion '${subjectVersion}' is not a well-formed semver version`,
    );
  }
  const ahead = compareSemver(subjectVersion, current);
  if (!Number.isNaN(ahead) && ahead > 0) {
    return reject(
      "subjectVersion",
      `subjectVersion '${subjectVersion}' is ahead of ${subjectKind.value} ` +
        `'${subject}' — its current manifest.json version is '${current}'`,
    );
  }

  // 6. fixedIn / status consistency — the rot guard (§5) and its mirror.
  if (fixedIn !== null && status.value === "open") {
    return reject(
      "fixedIn",
      `a finding whose status is 'open' must not set fixedIn (there is no fix to record yet)`,
    );
  }
  if (fixedIn === null && status.value === "fixed") {
    return reject(
      "fixedIn",
      `a finding whose status is 'fixed' must set fixedIn — the rot guard (§5); ` +
        `a fix version has to be recorded or the finding stays open`,
    );
  }
  // A fixedIn is a version, so it must be one: a bare token like `banana` (or a
  // `---` fence echo) would otherwise become a fixedIn that no join key ever
  // matches, the same F-D6 corruption the subjectVersion gate refuses above.
  if (fixedIn !== null && !isSemver(fixedIn)) {
    return reject(
      "fixedIn",
      `fixedIn '${fixedIn}' is not a well-formed semver version`,
    );
  }

  // 7. Body — F-D4 §5 risk 3: upstream finds must carry no absolute path from
  //    a downstream repository. Any absolute path that resolves outside the
  //    generator is refused; paths under the generator root are allowed.
  for (const line of body.split("\n")) {
    for (const abs of absolutePathsIn(line)) {
      if (!isContainedIn(abs, context.generatorRoot)) {
        return reject(
          "body",
          `body contains an absolute path outside the generator: '${abs}' ` +
            `(generator root: ${context.generatorRoot || "(none)"})`,
        );
      }
    }
  }

  return {
    success: true,
    value: {
      id,
      subject,
      subjectKind: subjectKind.value,
      subjectVersion,
      fixedIn,
      class: findingClass.value,
      severity: severity.value,
      surface: surface.value,
      status: status.value,
      body,
    },
  };
}

function reject<T>(
  field: string,
  message: string,
): Result<T, FindingValidationError> {
  return { success: false, error: new FindingValidationError(field, message) };
}

function enumValue<T extends string>(
  field: string,
  raw: string | null,
  allowed: readonly T[],
): Result<T, FindingValidationError> {
  if (raw !== null && allowed.includes(raw as T)) {
    return { success: true, value: raw as T };
  }
  return reject(
    field,
    `field '${field}' must be one of: ${allowed.join(", ")} — found '${String(raw)}'`,
  );
}

/**
 * Absolute-path tokens in a body line. Posix paths must have at least two
 * segments after the leading `/` (a bare `/tmp` or `/foo` in synthetic repro
 * prose is not a feasible client-path leak); Windows drive paths are matched
 * too and can never resolve under a posix generator root, so they are refused.
 */
const ABSOLUTE_PATH_IN_LINE =
  /(?:^|[ \t`'"()>])((?:\/(?:[0-9A-Za-z._~-]+\/)+[0-9A-Za-z._~-]+)|(?:[A-Za-z]:[\\/](?:[^\\/\s]+[\\/])+[^\\/\s]+))/g;

function absolutePathsIn(line: string): string[] {
  const paths: string[] = [];
  ABSOLUTE_PATH_IN_LINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ABSOLUTE_PATH_IN_LINE.exec(line)) !== null) {
    paths.push(m[1]);
  }
  return paths;
}

/**
 * Posix normalization without `node:path` (banned in domain): backslashes fold
 * to slashes so a Windows candidate normalizes too and simply differs from the
 * generator root, collapsing `.`/`..`/duplicate separators.
 */
function normalizePosix(p: string): string {
  const parts: string[] = [];
  for (const raw of p.replace(/\\/g, "/").split("/")) {
    if (raw === "" || raw === ".") continue;
    if (raw === "..") {
      parts.pop();
      continue;
    }
    parts.push(raw);
  }
  return "/" + parts.join("/");
}

/** Whether `candidate` resolves inside (or to) the generator root. */
function isContainedIn(candidate: string, root: string): boolean {
  const r = normalizePosix(root);
  const c = normalizePosix(candidate);
  return c === r || c.startsWith(r + "/");
}
