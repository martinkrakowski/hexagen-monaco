/**
 * Append the carried project name to a navigation path as `?name=`/`&name=`.
 *
 * Carried-name store-key contract: `?name=` is how the genesis flow threads
 * the Project Name step's value through every navigation leg between the
 * generation screens. Readers:
 *
 * - `AIGenerationPage.tsx` / `ImportProjectSpecPage.tsx` — trim it into
 *   `carriedName`, which (a) becomes the saved-project name and (b) is the
 *   KEY of the genesis settings-store snapshot
 *   (`genesisProjectSettingsStore.ts` / `loadEditedGenesisGovernance`).
 * - `ModelSelectionPage.tsx` — echoes it back on both genesis return legs of
 *   the /models detour.
 * - `GenerateWithAi.tsx` — forwards it into the detour and preserves it when
 *   consuming the `generate=1` auto-start intent.
 *
 * Every leg must carry the param: a leg that drops it re-keys the settings
 * store to the null (bypassed-name) key mid-flow, which mirrors later
 * Section A edits under the wrong store key and strands them on the next
 * round trip. When `name` is falsy the path is returned unchanged — that is
 * the legitimate bypassed-name flow (no `?name=` at all), not a dropped leg.
 *
 * This helper only builds the WRITE side; the read side (`searchParams
 * .get("name")` at the pages above) is intentionally not unified here.
 */
export function withCarriedName(
  path: string,
  name: string | null | undefined,
): string {
  if (!name) return path;
  // Deliberately plain string-append, NOT URLSearchParams: URLSearchParams
  // re-orders and re-normalizes existing params, which would churn the exact
  // URL-string assertions in the name-legs suite (and every history entry)
  // for zero behavior gain. Do not "modernize" this to URLSearchParams.
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}name=${encodeURIComponent(name)}`;
}
