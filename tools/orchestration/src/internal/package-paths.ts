/**
 * Paths inside the published package that more than one file must agree on.
 *
 * `package.json` `files` ships `public/`, and OW3c's wave-status serves its page
 * from there. Pinning the path as a comment let a later lane serve it from
 * anywhere under `public/` with nothing failing; pinning it here makes the path
 * a value that is imported and tested.
 */

/** The wave-status page, relative to the package root. */
export const WAVE_STATUS_PAGE = "public/wave-status/index.html";

/**
 * The wave-status page's URL, resolved from a bin module's own URL
 * (`import.meta.url`). Bins live two levels below the package root in both
 * `src/bins/` and `dist/bins/`, so `../../` reaches it from either. The file
 * need not exist for the URL to resolve.
 */
export function waveStatusPageUrl(moduleUrl: string | URL): URL {
  return new URL(`../../${WAVE_STATUS_PAGE}`, moduleUrl);
}
