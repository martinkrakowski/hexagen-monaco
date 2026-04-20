/**
 * Triggers a browser download of a Blob as a named file.
 *
 * Uses the hidden-anchor-click pattern, scoped here so consumers don't
 * have to touch `document.body` directly. Returns a Result so callers
 * can surface an error if the browser rejects the operation
 * (e.g. `URL.createObjectURL` fails in restricted contexts).
 */
export type DownloadBlobResult =
  | { success: true }
  | { success: false; error: Error };

export function downloadBlob(blob: Blob, filename: string): DownloadBlobResult {
  try {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err : new Error("Download failed"),
    };
  }
}
