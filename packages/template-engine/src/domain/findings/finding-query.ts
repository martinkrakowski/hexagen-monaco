import type { Finding, FindingStatus } from "./finding.js";
import { compareSemver, isSemver } from "./semver.js";

/**
 * The query half of the findings read path (plan §3 G4): what a caller asks
 * of the store, and the pure predicates that answer it. Everything here is
 * free of I/O — the reader supplies findings, this module says which of them
 * match — so the semantics are testable with no fixture tree.
 *
 * Every option is optional and an absent option means "no filter", not
 * "match nothing": `{}` is the whole store.
 */
export interface FindingQuery {
  /** Narrow to one subject id (e.g. "ci-github-actions"). */
  template?: string;
  /**
   * The subject version the caller is on. A finding whose `fixedIn` precedes
   * this version is excluded — a project on 1.4.0 no longer cares about a
   * defect fixed in 1.3.0. A `fixedIn` equal to the asked version still
   * applies: the plan's rule excludes strictly-earlier fixes, not the
   * boundary. `subjectVersion` does not participate — a finding recorded
   * against a version ahead of the one asked for is an open defect in the
   * current tree whose introduction point the record does not carry, and
   * hiding it would hide a possibly-live defect.
   */
  version?: string;
  /** Narrow to one lifecycle status ("open" | "fixed" | "wontfix"). */
  status?: FindingStatus;
}

/** The `template` option: the finding's subject is the named subject id. */
export function findingMatchesTemplate(
  finding: Finding,
  subjectId: string,
): boolean {
  return finding.subject === subjectId;
}

/** The `status` option: the finding is in the named lifecycle status. */
export function findingMatchesStatus(
  finding: Finding,
  status: FindingStatus,
): boolean {
  return finding.status === status;
}

/**
 * The `version` option: whether the finding still applies to the version the
 * caller is on. A finding with `fixedIn: null` (still open, or wontfix —
 * nothing recorded as fixing it) always applies. A finding fixed in F applies
 * unless F precedes the asked version V, i.e. `compareSemver(F, V) >= 0`.
 *
 * Both compared versions must be well-formed semver or the comparison is
 * undecidable and this predicate throws, naming the offending value. Letting
 * `compareSemver`'s NaN flow into `>= 0` would silently exclude everything —
 * the filter would turn itself off and claim to be narrowing. `fixedIn`
 * non-null is validator-gated semver on the read path, so in practice only a
 * malformed query version or a hand-built Finding can land here.
 */
export function findingAppliesToVersion(
  finding: Finding,
  version: string,
): boolean {
  if (!isSemver(version)) {
    throw new Error(
      `query version '${version}' is not a well-formed semver version — ` +
        `the version filter cannot be applied to the finding it asked about`,
    );
  }
  if (finding.fixedIn === null) return true;
  if (!isSemver(finding.fixedIn)) {
    throw new Error(
      `fixedIn '${finding.fixedIn}' is not a well-formed semver version — ` +
        `the version filter cannot be applied to finding '${finding.subject}/${finding.id}'`,
    );
  }
  return compareSemver(finding.fixedIn, version) >= 0;
}

/** All present options of `query` must hold — absent options impose nothing. */
export function findingMatchesQuery(
  finding: Finding,
  query: FindingQuery,
): boolean {
  if (
    query.template !== undefined &&
    !findingMatchesTemplate(finding, query.template)
  ) {
    return false;
  }
  if (
    query.status !== undefined &&
    !findingMatchesStatus(finding, query.status)
  ) {
    return false;
  }
  if (
    query.version !== undefined &&
    !findingAppliesToVersion(finding, query.version)
  ) {
    return false;
  }
  return true;
}
