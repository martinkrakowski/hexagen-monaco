/**
 * Minimal semver support for finding subject versions — no dependency, no
 * network. The only versions that reach this module are template manifest
 * versions and finding front-matter values, which this repo keeps plain
 * `major.minor.patch` (plus optional `-prerelease` / `+build`). The parser
 * accepts strings of that shape and rejects numeric identifiers with leading
 * zeros per the semver spec, so `01.2.0` can never be compared ahead-or-not
 * against a manifest `1.2.0` and then string-miss every join key (F-D6).
 * {@link isSemver} is the gate, {@link compareSemver} is a strict semver
 * ordering used for the "not ahead of the subject's current version" check
 * (§3 G2).
 */

// major.minor.patch must be `0` or `[1-9]\d*` (no leading zeros, semver
// §2); a prerelease identifier must be a zero-free numeric or an
// alphanumeric containing at least one non-digit (§11.4.3 ordering depends
// on that split). Build metadata keeps its own looser identifier rule.
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

interface SemverParts {
  // Kept as strings: numeric identifiers are compared as integer strings (see
  // compareNumericStrings) so identifiers above Number.MAX_SAFE_INTEGER do not
  // round to each other.
  major: string;
  minor: string;
  patch: string;
  prerelease: string[];
}

export function isSemver(version: string): boolean {
  return SEMVER_RE.test(version);
}

function parseSemver(version: string): SemverParts | null {
  const m = SEMVER_RE.exec(version);
  if (!m) return null;
  return {
    major: m[1],
    minor: m[2],
    patch: m[3],
    prerelease: m[4] ? m[4].split(".") : [],
  };
}

/**
 * Order two integer strings numerically without Number() precision loss.
 * SEMVER_RE forbids leading zeros, so length decides first and an equal length
 * compares lexicographically, which is then identical to numeric ordering.
 */
function compareNumericStrings(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Strict semver ordering: negative when a < b, zero when equal, positive when
 * a > b. Build metadata does not participate. The caller validates both sides
 * with {@link isSemver} first; when that was skipped and either side is not
 * parseable, NaN is returned so the caller can treat the comparison as
 * undecidable rather than silently ordering garbage. Numeric identifiers
 * compare as integer strings (length, then lexicographic — safe because the
 * gate forbids leading zeros), so identifiers above Number.MAX_SAFE_INTEGER
 * still order correctly where Number() would round them equal.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return NaN;
  const major = compareNumericStrings(pa.major, pb.major);
  if (major !== 0) return major;
  const minor = compareNumericStrings(pa.minor, pb.minor);
  if (minor !== 0) return minor;
  const patch = compareNumericStrings(pa.patch, pb.patch);
  if (patch !== 0) return patch;
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  // A release sorts above any of its own prereleases (1.0.0 > 1.0.0-beta).
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;
  const shared = Math.min(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < shared; i++) {
    const x = pa.prerelease[i];
    const y = pb.prerelease[i];
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = compareNumericStrings(x, y);
      if (d !== 0) return d;
    } else if (nx) {
      // Numeric identifiers sort below alphanumeric ones (semver §11.4.3).
      return -1;
    } else if (ny) {
      return 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  // A longer prerelease string with the same prefix sorts above the shorter.
  return pa.prerelease.length - pb.prerelease.length;
}
