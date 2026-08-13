/**
 * THE single name normalizer (A3).
 *
 * `normalizeStubName` (stubs.ts) and the private `toPascalCase` copies in
 * `architecture-files.ts` / `cross-context.ts` evolved separately with subtly
 * different word-splitting (the generator copies split on `[-.]` only, so an
 * underscored name PascalCased to `User_repo` while its stub identifier was
 * `UserRepo`). A stub identifier and the same name rendered anywhere else
 * (ownership registry, cross-context class names) must agree, so all of them
 * now share this module.
 *
 * Policy (the #242 `normalizeStubName` semantics — the better-tested of the
 * divergent copies, pinned in `normalize-stub-name.test.ts` and
 * `name-normalizer.test.ts`):
 *  - split on EVERY non-alphanumeric run (kebab, underscore, dot, space, ...)
 *    and capitalize each word — `user_repo` → `UserRepo`;
 *  - the identifier form additionally guards invalid identifier starts:
 *    empty → `Stub`, digit-leading → `Stub` prefix (`3d-renderer` →
 *    `Stub3dRenderer`).
 */

/**
 * PascalCase a raw name: split on non-alphanumeric runs, capitalize each
 * word. Makes NO identifier-validity promise (may return `""` or a
 * digit-leading string) — use `toPascalCaseIdentifier` where the result
 * becomes a TS identifier or must match one.
 */
export function toPascalCase(stem: string): string {
  return stem
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

/**
 * PascalCase with identifier guards: an empty result falls back to `Stub`,
 * a digit-leading result gains a `Stub` prefix so the name is a valid TS
 * identifier start. This is the form stub emission has always used (#242),
 * and what every other renderer of the same name must match.
 */
export function toPascalCaseIdentifier(stem: string): string {
  const pascal = toPascalCase(stem);
  if (pascal.length === 0) return "Stub";
  // Guarantee a valid identifier start (a digit-leading name like "3d-renderer").
  return /^[0-9]/.test(pascal) ? `Stub${pascal}` : pascal;
}
