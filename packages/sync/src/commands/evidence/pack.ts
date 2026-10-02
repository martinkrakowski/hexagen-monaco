import { createHash, randomBytes } from "node:crypto";
import { promises as fs, realpathSync } from "node:fs";
import path from "node:path";
import { BROWNFIELD_SCHEMA_VERSION, BundleIndex, Tip } from "@hexagen/shared";
import {
  readGrantKey,
  readSliceEngagementId,
  resolveGrantKey,
} from "@hexagen/shared/node/grant-key";
import {
  lineHash,
  signBundleIndex,
  signTip,
  splitTrace,
  verifyTip,
} from "@hexagen/shared/node/trace-chain";
import { writeZipStore, type ZipEntry } from "../report/zip-store.js";
import { resolveSidecarOut } from "../shared/sidecar-out.js";
import {
  checkLines,
  grantSignatureOk,
  type LineVerdict,
  type PackGrant,
} from "./check.js";

export interface EvidencePackOptions {
  /** Repo root; `.hexagen/` lives here. Never searched upward. */
  readonly root: string;
  readonly trace: string;
  readonly grantFiles: readonly string[];
  readonly out: string;
  readonly keyFile?: string;
  readonly engagement?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Test seam; defaults to `os.homedir()`. */
  readonly homeDir?: string;
  readonly now?: () => Date;
}

export interface EvidencePackResult {
  /** 0 packed; 1 the evidence is invalid (nothing written); 2 usage or precondition. */
  readonly exitCode: 0 | 1 | 2;
  readonly messages: readonly string[];
  readonly verdicts?: readonly LineVerdict[];
  /** Absolute path of the bundle, when one was written. */
  readonly bundle?: string;
}

const TRACE_RELATIVE = [".hexagen", "evidence", "trace.jsonl"];
const TIP_RELATIVE = [".hexagen", "evidence", "tip.json"];

const sha256 = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

function usage(message: string): EvidencePackResult {
  return { exitCode: 2, messages: [message] };
}

async function writeAtomic(target: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, data, { flag: "wx" });
    await fs.rename(tmp, target);
  } catch (error) {
    await fs.unlink(tmp).catch(() => undefined);
    throw error;
  }
}

function describe(v: LineVerdict): string {
  const where = v.seq === undefined ? `line ${v.index}` : `seq ${v.seq}`;
  return `${where}: ${v.reasons.join("; ")}`;
}

/**
 * `hexagen evidence pack`: verifies a brownfield trace (chain, line shape,
 * docs/kernel/TRACE.md Rules, the anchored tip) and, only if every line is
 * sound, writes an HMAC'd bundle zip under `.hexagen/` and advances
 * `.hexagen/evidence/tip.json`. On any invalid line it writes nothing at all,
 * so a bundle that exists is a bundle that passed.
 */
export async function runEvidencePack(
  options: EvidencePackOptions,
): Promise<EvidencePackResult> {
  const root = path.resolve(options.root);
  const now = options.now ?? (() => new Date());
  const env = options.env ?? process.env;

  const out = await resolveSidecarOut(root, options.out).catch(() => null);
  if (!out) {
    return usage(
      `--out must name a file under ${path.join(root, ".hexagen")}${path.sep}; got "${options.out}"`,
    );
  }
  if (options.grantFiles.length === 0) {
    return usage("at least one --grant <file> is required");
  }

  // The tip anchors one file. Packing any other trace would let a caller route
  // around the anchor, so the canonical trace is the only one accepted.
  const tracePath = path.resolve(options.trace);
  const canonicalTrace = path.join(root, ...TRACE_RELATIVE);
  try {
    if (
      realpathSync.native(tracePath) !== realpathSync.native(canonicalTrace)
    ) {
      return usage(
        `the tip anchors only ${canonicalTrace}; pack that file (got ${tracePath})`,
      );
    }
  } catch (error) {
    return usage(
      `cannot read the trace ${tracePath}: ${(error as Error).message}`,
    );
  }

  const sliceId = readSliceEngagementId(root);
  const resolved = resolveGrantKey({
    keyFile: options.keyFile,
    env,
    engagementId: options.engagement ?? sliceId,
    workspaceRoot: root,
    homeDir: options.homeDir,
  });
  if (resolved.path === null) {
    return usage(`cannot locate the engagement key: ${resolved.problem}`);
  }
  const key = readGrantKey(resolved.path);
  if (!key.ok) return usage(`engagement key unusable: ${key.problem}`);
  const keyHex = key.keyHex;

  const grants = new Map<string, PackGrant>();
  const grantProblems: string[] = [];
  const grantTexts = new Map<string, string>();
  for (const file of options.grantFiles) {
    let text: string;
    let parsed: unknown;
    try {
      text = await fs.readFile(path.resolve(file), "utf8");
      parsed = JSON.parse(text);
    } catch (error) {
      return usage(`cannot read grant ${file}: ${(error as Error).message}`);
    }
    const g = parsed as Partial<PackGrant> | null;
    if (
      g === null ||
      typeof g !== "object" ||
      typeof g.id !== "string" ||
      g.id.length === 0 ||
      !Array.isArray(g.tools) ||
      typeof g.expires_at !== "string"
    ) {
      return usage(
        `grant ${file} is not a Grant (needs id, tools, expires_at)`,
      );
    }
    if (grantTexts.has(g.id)) {
      return usage(`grant id '${g.id}' is given twice`);
    }
    grantTexts.set(g.id, text);
    if (!grantSignatureOk(g as PackGrant, keyHex)) {
      grantProblems.push(
        `grant '${g.id}' (${file}): signature does not verify with the engagement key`,
      );
      continue;
    }
    grants.set(g.id, g as PackGrant);
  }

  const traceBytes = await fs.readFile(tracePath);
  const split = splitTrace(traceBytes.toString("utf8"));
  const problems: string[] = [...grantProblems];
  if (split.lines.length === 0) problems.push("the trace has no lines");
  if (split.torn) {
    problems.push(
      "the last line is torn (invalid JSON or no trailing newline)",
    );
  }
  const verdicts = checkLines(split.lines, grants);
  for (const v of verdicts) if (!v.valid) problems.push(describe(v));

  // The anchored tip: catches tail truncation and a restart from genesis,
  // which a chain that only looks backwards cannot.
  const tipPath = path.join(root, ...TIP_RELATIVE);
  let tipChecked = false;
  let tipText: string | null = null;
  try {
    tipText = await fs.readFile(tipPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      problems.push(`cannot read ${tipPath}: ${(error as Error).message}`);
      tipText = null;
    }
  }
  if (tipText !== null) {
    let tip: Tip | undefined;
    try {
      tip = Tip.parse(JSON.parse(tipText));
    } catch (error) {
      problems.push(
        `${tipPath} is not a valid tip: ${(error as Error).message}`,
      );
    }
    if (tip) {
      if (!verifyTip(tip, keyHex)) {
        problems.push("tip.json HMAC does not verify with the engagement key");
      } else {
        tipChecked = true;
        const at = split.lines[tip.seq];
        if (at === undefined) {
          problems.push(
            `the trace ends before the recorded tip (seq ${tip.seq}): lines were removed`,
          );
        } else if (at.value === undefined || lineHash(at.value) !== tip.hash) {
          problems.push(
            `the line at the recorded tip (seq ${tip.seq}) differs from the one anchored: the trace was altered or restarted`,
          );
        }
      }
    }
  }

  if (problems.length > 0) {
    return {
      exitCode: 1,
      messages: [
        "evidence pack FAILED; no bundle written and the tip is unchanged:",
        ...problems.map((p) => `  - ${p}`),
      ],
      verdicts,
    };
  }

  const last = split.lines[split.lines.length - 1];
  const lastHash = lineHash(last?.value);
  const lastSeq = split.lines.length - 1;
  const newTip: Tip = {
    seq: lastSeq,
    hash: lastHash,
    hmac: signTip(lastSeq, lastHash, keyHex),
  };

  const evidence = verdicts.filter((v) => v.kind === "evidence");
  const denials = verdicts.filter((v) => v.kind === "denial");
  const verdictDoc = {
    schemaVersion: BROWNFIELD_SCHEMA_VERSION,
    traceSha256: sha256(traceBytes),
    lines: verdicts.map((v) => ({
      seq: v.index,
      kind: v.kind,
      valid: v.valid,
      reasons: v.reasons,
    })),
    // Lines that document a refused attempt. They skip the allowlist and
    // window checks, so they are never evidence that a write was allowed.
    denials: denials.map((v) => ({
      seq: v.index,
      haltReason: v.haltReason,
      grantId: v.grantId ?? null,
      tool: v.tool ?? null,
      time: v.time ?? null,
      reason: v.reason ?? null,
    })),
    evidence: { count: evidence.length, seqs: evidence.map((v) => v.index) },
    tipAnchoredBefore: tipChecked,
  };

  const referenced = [
    ...new Set(
      verdicts.flatMap((v) => (v.grantId === undefined ? [] : [v.grantId])),
    ),
  ].sort();
  const entries: ZipEntry[] = [
    { name: "evidence/trace.jsonl", content: traceBytes },
    {
      name: "evidence/verdicts.json",
      content: `${JSON.stringify(verdictDoc, null, 2)}\n`,
    },
    {
      name: "evidence/tip.json",
      content: `${JSON.stringify(newTip, null, 2)}\n`,
    },
  ];
  const files: BundleIndex["files"] = [
    {
      path: "evidence/trace.jsonl",
      role: "evidence",
      sha256: sha256(traceBytes),
    },
    {
      path: "evidence/verdicts.json",
      role: "evidence",
      sha256: sha256(entries[1]?.content as string),
    },
    {
      path: "evidence/tip.json",
      role: "tip",
      sha256: sha256(entries[2]?.content as string),
    },
  ];
  referenced.forEach((id, i) => {
    const text = grantTexts.get(id) as string;
    const name = `grants/${i}-${id.replace(/[^A-Za-z0-9._-]/g, "_")}.json`;
    entries.push({ name, content: text });
    files.push({ path: name, role: "grant", sha256: sha256(text) });
  });

  const indexBody = {
    schemaVersion: BROWNFIELD_SCHEMA_VERSION,
    createdAt: now().toISOString(),
    sliceId: sliceId ?? options.engagement ?? "unspecified",
    files,
  };
  const index = BundleIndex.parse({
    ...indexBody,
    hmac: signBundleIndex(indexBody, keyHex),
  });
  entries.unshift({
    name: "bundle.json",
    content: `${JSON.stringify(index, null, 2)}\n`,
  });

  try {
    await fs.mkdir(path.dirname(out), { recursive: true });
    const tmp = `${out}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      await fs.writeFile(tmp, writeZipStore(entries), { flag: "wx" });
      await fs.rename(tmp, out);
    } catch (error) {
      await fs.unlink(tmp).catch(() => undefined);
      throw error;
    }
    try {
      await writeAtomic(tipPath, `${JSON.stringify(newTip, null, 2)}\n`);
    } catch (error) {
      await fs.unlink(out).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    return {
      exitCode: 2,
      messages: [`could not write the bundle: ${(error as Error).message}`],
      verdicts,
    };
  }
  return {
    exitCode: 0,
    messages: [
      `evidence pack ok: ${evidence.length} evidence line(s), ${denials.length} denial(s); tip seq ${lastSeq}`,
      `bundle: ${out}`,
    ],
    verdicts,
    bundle: out,
  };
}
