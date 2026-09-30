import {
  exitCodeFor,
  formatReport,
  isScanned,
  scanBytes,
  type Offence,
  type ScanReport,
} from "./lib/scan.js";

/** The listing or a read failed. Not "nothing to check": a check that cannot look must not pass. */
export const EXIT_UNUSABLE = 2;

export interface ControlBytesCliIo {
  readonly log: (text: string) => void;
  readonly logError: (text: string) => void;
  /**
   * Every file the check is responsible for. In production this is
   * `git ls-files -z --cached --others --exclude-standard`: tracked files PLUS
   * untracked-but-not-ignored ones, so a file a lane just wrote and has not
   * staged is already in scope — that is precisely the moment the byte gets in.
   * `--exclude-standard` keeps `.gitignore`d operator data (`briefs/`,
   * `assets/inputs/*`) and `node_modules` out without a second list to maintain.
   */
  readonly listFiles: () => Promise<readonly string[]>;
  readonly readBytes: (path: string) => Promise<Uint8Array>;
  readonly now: () => number;
}

/** A read that failed because the file is not there — distinct from a read that failed. */
function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

export async function runCli(io: ControlBytesCliIo): Promise<number> {
  let listed: readonly string[];
  try {
    listed = await io.listFiles();
  } catch (error) {
    io.logError(
      `control-bytes: cannot list the files to scan: ` +
        `${error instanceof Error ? error.message : String(error)} — ` +
        `refusing to report that as nothing to check`,
    );
    return EXIT_UNUSABLE;
  }
  const files = listed.filter(isScanned);
  // This repo's text-file set cannot legitimately be empty — it is 919 files. Zero
  // in scope means the listing did not look: a wrong working directory, a sparse
  // checkout, a `git ls-files` that changed under us. Exiting 0 there prints
  // "scanned 0 text files ... OK" and reads as a pass, which is the exact failure
  // this whole lane is about. `anchors-cli` returns 0 on an empty manifest
  // directory and is right to: that directory can legitimately hold nothing.
  if (files.length === 0) {
    io.logError(
      `control-bytes: the listing produced no text files to scan — refusing to report ` +
        `that as nothing to check`,
    );
    return EXIT_UNUSABLE;
  }
  const started = io.now();
  const offences: Offence[] = [];
  const missing: string[] = [];
  for (const path of files) {
    let bytes: Uint8Array;
    try {
      bytes = await io.readBytes(path);
    } catch (error) {
      // A file listed in the index but deleted from the working tree has no bytes
      // to be wrong, so it is skipped and named. Anything else — a permission, a
      // device error — is a check that could not look, and fails.
      if (isMissing(error)) {
        missing.push(path);
        continue;
      }
      io.logError(
        `control-bytes: cannot read ${path}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return EXIT_UNUSABLE;
    }
    offences.push(...scanBytes(path, bytes));
  }
  const report: ScanReport = {
    filesScanned: files.length - missing.length,
    filesMissing: missing,
    offences,
    elapsedMs: io.now() - started,
  };
  const text = formatReport(report);
  if (offences.length === 0) io.log(text);
  else io.logError(text);
  return exitCodeFor(report);
}
