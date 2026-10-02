import { createHash } from "node:crypto";
import JSZip from "jszip";

/** Synthetic bundle builders for the viewer tests. Nothing here is real client data. */

export const sha = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

export interface FixtureFile {
  readonly path: string;
  readonly role: string;
  readonly content: string;
}

const NOW = "2026-10-01T10:00:00.000Z";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const ZERO = "0".repeat(64);

export function observed(
  over: { edgesComplete?: boolean; truncated?: boolean } = {},
): string {
  const complete = over.edgesComplete ?? true;
  return JSON.stringify({
    schemaVersion: "1.0.0",
    repo: { commit: COMMIT },
    generatedAt: NOW,
    packages: {
      collected: true,
      items: [
        { name: "@acme/core", root: "core", manifestFile: "core/package.json" },
      ],
    },
    languages: {
      collected: true,
      items: [{ name: "TypeScript", fileCount: 3 }],
    },
    build: { collected: true, items: [] },
    generated: { collected: true, items: [] },
    dontTouch: { collected: true, items: [] },
    edges: {
      collected: true,
      unreadLanguages: complete ? [] : ["Go"],
      items: [],
    },
    unresolved: { collected: true, items: [] },
    limits: { truncated: over.truncated ?? false, reasons: [] },
  });
}

export const slice = JSON.stringify({
  schemaVersion: "1.0.0",
  id: "slice-1",
  repo: { commit: COMMIT },
  paths: ["core/"],
  excludes: [],
  createdBy: "fde",
  createdAt: NOW,
});

export const contract = JSON.stringify({
  schemaVersion: "1.0.0",
  sliceId: "slice-1",
  rules: [],
  knownViolations: [],
});

export const tip = JSON.stringify({ seq: 1, hash: ZERO, hmac: ZERO });

export const TRACE_LINES = [
  JSON.stringify({ seq: 0, tool: "read_file", ok: true }),
  JSON.stringify({ seq: 1, tool: "write_file", halt: "grant_denied" }),
];
export const trace = `${TRACE_LINES.join("\n")}\n`;

export const verdicts = JSON.stringify({
  schemaVersion: "1.0.0",
  traceSha256: ZERO,
  lines: [
    { seq: 0, kind: "evidence", valid: true, reasons: [] },
    { seq: 1, kind: "denial", valid: true, reasons: [] },
  ],
  denials: [
    {
      seq: 1,
      haltReason: "grant_denied",
      grantId: "g1",
      tool: "write_file",
      time: NOW,
      reason: "outside the slice",
    },
  ],
  evidence: { count: 1, seqs: [0] },
  tipAnchoredBefore: true,
  previousTip: null,
});

export const grant = JSON.stringify({ id: "g1", tools: ["read_file"] });

export function validFiles(): FixtureFile[] {
  return [
    { path: "observed.json", role: "observed", content: observed() },
    { path: "slice.json", role: "slice", content: slice },
    { path: "contract.json", role: "contract", content: contract },
    { path: "tip.json", role: "tip", content: tip },
    { path: "evidence/trace.jsonl", role: "evidence", content: trace },
    { path: "evidence/verdicts.json", role: "evidence", content: verdicts },
    { path: "grants/0-g1.json", role: "grant", content: grant },
  ];
}

export interface BuildOptions {
  /** Entries to put in the zip but leave out of the index. */
  readonly extra?: readonly { name: string; content: string }[];
  /** Index entries whose zip entry is not written. */
  readonly omit?: readonly string[];
  /** Override the index sha for one path. */
  readonly badSha?: Readonly<Record<string, string>>;
  readonly compression?: "STORE" | "DEFLATE";
}

export async function buildBundle(
  files: readonly FixtureFile[] = validFiles(),
  options: BuildOptions = {},
): Promise<Uint8Array> {
  const index = {
    schemaVersion: "1.0.0",
    createdAt: NOW,
    sliceId: "slice-1",
    files: files.map((f) => ({
      path: f.path,
      role: f.role,
      sha256: options.badSha?.[f.path] ?? sha(f.content),
    })),
    hmac: ZERO,
  };
  const zip = new JSZip();
  const opts = {
    compression: options.compression ?? "DEFLATE",
    createFolders: false,
  } as const;
  zip.file("bundle.json", JSON.stringify(index), opts);
  for (const f of files) {
    if (options.omit?.includes(f.path)) continue;
    zip.file(f.path, f.content, opts);
  }
  for (const e of options.extra ?? []) zip.file(e.name, e.content, opts);
  return zip.generateAsync({ type: "uint8array", platform: "UNIX" });
}

/**
 * Renames entries in the raw bytes (local headers and central directory), so a
 * name no zip writer would accept (`..`, `\`, NUL, duplicates) can be tested.
 * Both names must have the same length.
 */
export function renameEntry(
  zip: Uint8Array,
  from: string,
  to: string,
): Uint8Array {
  if (from.length !== to.length) throw new Error("same length required");
  const out = Uint8Array.from(zip);
  const a = Buffer.from(from);
  const b = Buffer.from(to);
  const buf = Buffer.from(out.buffer, out.byteOffset, out.byteLength);
  let at = buf.indexOf(a);
  while (at >= 0) {
    b.copy(buf, at);
    at = buf.indexOf(a, at + 1);
  }
  return out;
}

/** Sets the symlink mode bits on the central-directory record for `name`. */
export function markSymlink(zip: Uint8Array, name: string): Uint8Array {
  const out = Uint8Array.from(zip);
  const buf = Buffer.from(out.buffer, out.byteOffset, out.byteLength);
  let p = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(p + 10);
  p = buf.readUInt32LE(p + 16);
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    if (buf.subarray(p + 46, p + 46 + nameLen).toString() === name) {
      buf.writeUInt16LE(0x031e, p + 4); // made by UNIX
      buf.writeUInt32LE((0o120777 << 16) >>> 0, p + 38);
      return out;
    }
    p += 46 + nameLen + extra + comment;
  }
  throw new Error(`no entry ${name}`);
}

/** Rewrites the declared uncompressed size of `name` in the central directory. */
export function lieAboutSize(
  zip: Uint8Array,
  name: string,
  size: number,
): Uint8Array {
  const out = Uint8Array.from(zip);
  const buf = Buffer.from(out.buffer, out.byteOffset, out.byteLength);
  let p = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(p + 10);
  p = buf.readUInt32LE(p + 16);
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    if (buf.subarray(p + 46, p + 46 + nameLen).toString() === name) {
      buf.writeUInt32LE(size, p + 24);
      return out;
    }
    p += 46 + nameLen + extra + comment;
  }
  throw new Error(`no entry ${name}`);
}

/** Renames an entry in its LOCAL header only; the central directory keeps the old name. */
export function renameLocalOnly(
  zip: Uint8Array,
  from: string,
  to: string,
): Uint8Array {
  if (from.length !== to.length) throw new Error("same length required");
  const out = Uint8Array.from(zip);
  const buf = Buffer.from(out.buffer, out.byteOffset, out.byteLength);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const cd = buf.readUInt32LE(eocd + 16);
  const a = Buffer.from(from);
  let at = buf.indexOf(a);
  while (at >= 0 && at < cd) {
    Buffer.from(to).copy(buf, at);
    at = buf.indexOf(a, at + 1);
  }
  return out;
}

/** Sets the encrypted flag (bit 0) on the central-directory record of `name`. */
export function markEncrypted(zip: Uint8Array, name: string): Uint8Array {
  const out = Uint8Array.from(zip);
  const buf = Buffer.from(out.buffer, out.byteOffset, out.byteLength);
  let p = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(p + 10);
  p = buf.readUInt32LE(p + 16);
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(p + 28);
    const skip = nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (buf.subarray(p + 46, p + 46 + nameLen).toString() === name) {
      buf.writeUInt16LE(buf.readUInt16LE(p + 8) | 1, p + 8);
      return out;
    }
    p += 46 + skip;
  }
  throw new Error(`no entry ${name}`);
}

/** Writes a 16-bit value into the end-of-central-directory record at `offset` (4, 6, 8 or 10). */
export function patchEocd16(
  zip: Uint8Array,
  offset: 4 | 6 | 8 | 10,
  value: number,
): Uint8Array {
  const out = Uint8Array.from(zip);
  const buf = Buffer.from(out.buffer, out.byteOffset, out.byteLength);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  buf.writeUInt16LE(value, eocd + offset);
  return out;
}

/** Breaks the signature of the first central-directory record. */
export function damageCentralDirectory(zip: Uint8Array): Uint8Array {
  const out = Uint8Array.from(zip);
  const buf = Buffer.from(out.buffer, out.byteOffset, out.byteLength);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  buf.writeUInt32LE(0xdeadbeef, buf.readUInt32LE(eocd + 16));
  return out;
}
