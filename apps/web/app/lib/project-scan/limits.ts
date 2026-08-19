/**
 * Client-safe scan limits (no `node:` imports). Shared by the name step UI,
 * the scan page, the route, the unpacker, and the CLI adapter.
 */

/** Compressed upload cap. Enforced on Content-Length and again on the zip part. */
export const MAX_SCAN_ZIP_BYTES = 32 * 1024 * 1024;

/**
 * Multipart wrapping around the zip (boundaries, `name` field, part headers).
 * Content-Length is checked against this *before* `formData()` buffers the body.
 */
export const MAX_SCAN_REQUEST_BYTES = MAX_SCAN_ZIP_BYTES + 256 * 1024;

export const MAX_PROJECT_NAME_CHARS = 100;

/** Route `maxDuration` is 60s. Exec must finish with headroom for unpack + JSON. */
export const SCAN_TIMEOUT_MS = 45_000;

export const MAX_SCAN_ZIP_ENTRIES = 20_000;
export const MAX_SCAN_ENTRY_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
export const MAX_SCAN_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

export const MAX_SCAN_LAYOUT_EXCERPT_CHARS = 8_000;
export const MAX_SCAN_REPORT_CHARS = 32_000;
export const MAX_SCAN_ERROR_CHARS = 8_000;
