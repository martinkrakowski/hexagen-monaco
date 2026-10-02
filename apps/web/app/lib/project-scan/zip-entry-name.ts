/**
 * Browser-safe zip entry-name check (no `node:` imports). The server unpacker
 * (`zip-unpack.ts`) and the browser bundle viewer both use it, so the two cannot
 * drift: a name this rejects is never written to disk and never read in a tab.
 */

const WINDOWS_ABS = /^[a-zA-Z]:[\\/]/;
const UNC = /^[\\/]{2}/;

/**
 * True when `entryName` could leave its destination: empty, a NUL byte, an
 * absolute POSIX/Windows/UNC path, or a `..` segment (either separator).
 */
export function isUnsafeEntryName(entryName: string): boolean {
  if (entryName.length === 0 || entryName.includes("\0")) return true;
  if (
    entryName.startsWith("/") ||
    WINDOWS_ABS.test(entryName) ||
    UNC.test(entryName)
  ) {
    return true;
  }
  const posix = entryName.replace(/\\/g, "/");
  return (
    posix.startsWith("/") ||
    posix.split("/").some((segment) => segment === "..")
  );
}
