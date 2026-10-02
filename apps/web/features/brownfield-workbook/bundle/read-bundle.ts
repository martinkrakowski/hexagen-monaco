import JSZip from "jszip";
import {
  BundleIndex,
  Contract,
  ObservedReport,
  Slice,
  Tip,
  cleanText,
} from "@hexagen/shared";
import {
  MAX_SCAN_ENTRY_UNCOMPRESSED_BYTES,
  MAX_SCAN_UNCOMPRESSED_BYTES,
  MAX_SCAN_ZIP_ENTRIES,
} from "@/lib/project-scan/limits";
import { isUnsafeEntryName } from "@/lib/project-scan/zip-entry-name";
import { readZipDirectory, ZipDirectoryError } from "./zip-directory";
import { parseVerdicts, type PackVerdicts } from "./verdicts";

/**
 * Parses a `hexagen workbook export` zip entirely in the browser (BW-D2). The
 * bytes are never sent anywhere: this module has no network access and keeps
 * nothing but the returned in-memory value.
 *
 * It checks entry names, symlinks, duplicates and the scan caps (streamed, so a
 * zip bomb cannot exhaust memory), then the bundle index: every listed file must
 * exist with a matching sha256, and nothing unlisted may be present. It cannot
 * check the index HMAC: the key never leaves the engagement machine.
 */

export interface BundleLimits {
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
}

export const BUNDLE_LIMITS: BundleLimits = {
  maxEntries: MAX_SCAN_ZIP_ENTRIES,
  maxEntryBytes: MAX_SCAN_ENTRY_UNCOMPRESSED_BYTES,
  maxTotalBytes: MAX_SCAN_UNCOMPRESSED_BYTES,
};

export interface LoadedBundle {
  readonly index: BundleIndex;
  /** Every listed file's text, byte for byte as decoded (render through `cleanText`). */
  readonly texts: ReadonlyMap<string, string>;
  readonly observed: ObservedReport | null;
  readonly slice: Slice | null;
  readonly contract: Contract | null;
  readonly tip: Tip | null;
  readonly grants: readonly { readonly path: string; readonly text: string }[];
  readonly proposals: readonly string[];
  /**
   * Each proposal entry's raw bytes, already sha256-checked, by path. They are
   * NOT decoded here: a non-UTF-8 patch must not block opening the bundle. The
   * right panel decodes them for display with a non-fatal decoder.
   */
  readonly proposalFiles: ReadonlyMap<string, Uint8Array>;
  readonly trace: string | null;
  /** `null` when `evidence/verdicts.json` is absent, `"invalid"` when it cannot be read. */
  readonly verdicts: PackVerdicts | "invalid" | null;
}

export type ReadBundleResult =
  | { readonly ok: true; readonly bundle: LoadedBundle }
  | {
      readonly ok: false;
      readonly errors: readonly string[];
      /** Bytes inflated before a size cap stopped the read (proves the cap streams). */
      readonly bytesRead?: number;
    };

class Refusal extends Error {
  constructor(
    message: string,
    readonly bytesRead?: number,
  ) {
    super(message);
  }
}

const shown = (name: string): string => JSON.stringify(cleanText(name));

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** JSZip's streaming API: real, but missing from its type definitions. */
interface EntryStream {
  on(event: "data", cb: (chunk: Uint8Array) => void): EntryStream;
  on(event: "error", cb: (error: unknown) => void): EntryStream;
  on(event: "end", cb: () => void): EntryStream;
  pause(): void;
  resume(): void;
}

function inflateCapped(
  entry: JSZip.JSZipObject,
  name: string,
  maxEntryBytes: number,
  budget: { remaining: number },
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const stream = (
      entry as unknown as {
        internalStream(type: "uint8array"): EntryStream;
      }
    ).internalStream("uint8array");
    stream.on("data", (chunk: Uint8Array) => {
      size += chunk.length;
      if (size > maxEntryBytes) {
        stream.pause();
        reject(
          new Refusal(
            `entry ${shown(name)} exceeds the ${maxEntryBytes.toLocaleString()}-byte entry limit`,
            size,
          ),
        );
        return;
      }
      if (size > budget.remaining) {
        stream.pause();
        reject(
          new Refusal(
            `the bundle's total size exceeds its limit (reached at entry ${shown(name)})`,
            size,
          ),
        );
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", () =>
      reject(new Refusal(`entry ${shown(name)} could not be read`)),
    );
    stream.on("end", () => {
      const out = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) {
        out.set(c, at);
        at += c.length;
      }
      budget.remaining -= size;
      resolve(out);
    });
    stream.resume();
  });
}

const FIXED_TEXT_PATHS = new Set([
  "observed.json",
  "slice.json",
  "contract.json",
  "tip.json",
  "evidence/trace.jsonl",
  "evidence/verdicts.json",
]);
const isTextEntry = (f: { path: string; role: string }): boolean =>
  FIXED_TEXT_PATHS.has(f.path) || f.role === "grant";

export async function readBundle(
  data: Uint8Array,
  overrides: Partial<BundleLimits> = {},
): Promise<ReadBundleResult> {
  const limits: BundleLimits = { ...BUNDLE_LIMITS, ...overrides };
  try {
    return { ok: true, bundle: await load(data, limits) };
  } catch (error) {
    if (error instanceof Refusal) {
      return {
        ok: false,
        errors: error.message.split("\n"),
        ...(error.bytesRead === undefined
          ? {}
          : { bytesRead: error.bytesRead }),
      };
    }
    if (error instanceof ZipDirectoryError) {
      return { ok: false, errors: [error.message] };
    }
    return {
      ok: false,
      errors: ["the file could not be read as a zip bundle"],
    };
  }
}

const refuse = (msg: string): never => {
  throw new Refusal(msg);
};

async function load(
  data: Uint8Array,
  limits: BundleLimits,
): Promise<LoadedBundle> {
  if (typeof crypto === "undefined" || crypto.subtle === undefined) {
    refuse("the viewer needs HTTPS or localhost (WebCrypto unavailable)");
  }
  if (data.length > limits.maxTotalBytes) {
    refuse(
      `the file is too large (over ${limits.maxTotalBytes.toLocaleString()} bytes)`,
    );
  }
  const dir = readZipDirectory(data, limits.maxEntries);

  const seen = new Set<string>();
  let declaredTotal = 0;
  for (const e of dir) {
    if (isUnsafeEntryName(e.name) || e.name.includes("\\")) {
      refuse(`unsafe entry name ${shown(e.name)}`);
    }
    if (seen.has(e.name)) refuse(`duplicate entry name ${shown(e.name)}`);
    seen.add(e.name);
    if (e.isDirectory)
      refuse(`directory entry ${shown(e.name)} is not allowed`);
    if (e.isSymlink) refuse(`symlink entry ${shown(e.name)} is not allowed`);
    if (e.encrypted) refuse(`entry ${shown(e.name)} is encrypted`);
    if (e.declaredSize > limits.maxEntryBytes) {
      refuse(
        `entry ${shown(e.name)} exceeds the ${limits.maxEntryBytes.toLocaleString()}-byte entry limit`,
      );
    }
    declaredTotal += e.declaredSize;
  }
  if (declaredTotal > limits.maxTotalBytes) {
    refuse(
      `the bundle's declared total size exceeds ${limits.maxTotalBytes.toLocaleString()} bytes`,
    );
  }

  // No `checkCRC32`: it inflates every entry, uncapped. The sha256 check below
  // is the integrity check, and it runs over the capped stream.
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    return refuse("the file could not be read as a zip archive");
  }

  // JSZip's view must match the central-directory view we just checked: it keys
  // entries by its own (normalised) name and could hide a name we refused.
  const zipNames = Object.keys(zip.files);
  const agree =
    zipNames.length === seen.size &&
    zipNames.every(
      (n) => seen.has(n) && zip.files[n]?.unsafeOriginalName === n,
    );
  if (!agree) {
    refuse(
      "the zip's entry names disagree between its local headers and its central directory",
    );
  }

  const budget = { remaining: limits.maxTotalBytes };
  const read = async (name: string): Promise<Uint8Array> => {
    const entry = zip.files[name];
    if (entry === undefined)
      return refuse(`entry ${shown(name)} is unreadable`);
    return inflateCapped(entry, name, limits.maxEntryBytes, budget);
  };

  if (!seen.has("bundle.json")) refuse("bundle.json is missing from the zip");
  const strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const decode = (bytes: Uint8Array, name: string): string => {
    try {
      return strict.decode(bytes);
    } catch {
      return refuse(`${shown(name)} is not valid UTF-8 text`);
    }
  };

  const indexText = decode(await read("bundle.json"), "bundle.json");
  let index: BundleIndex;
  try {
    index = BundleIndex.parse(JSON.parse(indexText));
  } catch {
    return refuse("bundle.json is not a valid bundle index");
  }

  const listed = new Set<string>();
  const problems: string[] = [];
  for (const f of index.files) {
    if (listed.has(f.path)) problems.push(`index lists ${shown(f.path)} twice`);
    listed.add(f.path);
  }
  for (const name of seen) {
    if (name !== "bundle.json" && !listed.has(name)) {
      problems.push(`entry ${shown(name)} is not listed in bundle.json`);
    }
  }
  for (const f of index.files) {
    if (!seen.has(f.path))
      problems.push(`listed file ${shown(f.path)} is missing from the zip`);
  }
  if (problems.length > 0) throw new Refusal(problems.join("\n"));

  const texts = new Map<string, string>();
  const proposalFiles = new Map<string, Uint8Array>();
  for (const f of index.files) {
    const bytes = await read(f.path);
    if ((await sha256Hex(bytes)) !== f.sha256) {
      problems.push(
        `${shown(f.path)} does not match its sha256 in bundle.json`,
      );
      continue;
    }
    // The sha256 above covers every entry's raw bytes. Only the documents the
    // viewer reads as text are decoded; a proposal is listed by path, so a
    // non-UTF-8 patch never blocks opening the bundle.
    if (isTextEntry(f)) texts.set(f.path, decode(bytes, f.path));
    if (f.role === "proposal") proposalFiles.set(f.path, bytes);
  }
  if (problems.length > 0) throw new Refusal(problems.join("\n"));

  // The fixed path of each typed document, mirroring the export allow-list.
  const FIXED_PATH = {
    observed: "observed.json",
    slice: "slice.json",
    contract: "contract.json",
    tip: "tip.json",
  } as const;
  for (const f of index.files) {
    const want = FIXED_PATH[f.role as keyof typeof FIXED_PATH];
    if (want !== undefined && f.path !== want) {
      refuse(`${shown(f.path)} has role ${f.role}, expected path ${want}`);
    }
  }
  const typed = <T>(
    role: keyof typeof FIXED_PATH,
    schema: { parse(v: unknown): T },
  ): T | null => {
    const path = FIXED_PATH[role];
    const text = texts.get(path);
    if (text === undefined) return null;
    try {
      return schema.parse(JSON.parse(text));
    } catch {
      return refuse(`${shown(path)} is not a valid ${role} document`);
    }
  };

  const verdictText = texts.get("evidence/verdicts.json");
  return {
    index,
    texts,
    observed: typed("observed", ObservedReport),
    slice: typed("slice", Slice),
    contract: typed("contract", Contract),
    tip: typed("tip", Tip),
    grants: index.files
      .filter((f) => f.role === "grant")
      .map((f) => ({ path: f.path, text: texts.get(f.path) as string })),
    proposals: index.files
      .filter((f) => f.role === "proposal")
      .map((f) => f.path),
    proposalFiles,
    trace: texts.get("evidence/trace.jsonl") ?? null,
    verdicts: verdictText === undefined ? null : parseVerdicts(verdictText),
  };
}
