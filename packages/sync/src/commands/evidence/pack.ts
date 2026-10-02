import { createHash, randomBytes } from "node:crypto";
import { promises as fs, realpathSync } from "node:fs";
import path from "node:path";
import {
  BROWNFIELD_SCHEMA_VERSION,
  type Grant,
  BUNDLE_FORBIDDEN_PATH_PATTERN,
  BundleIndex,
  Tip,
} from "@hexagen/shared";
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
  withTraceLock,
} from "@hexagen/shared/node/trace-chain";
import { writeZipStore, type ZipEntry } from "../report/zip-store.js";
import { writeFileReplace } from "../shared/sidecar-write.js";
import { realpathOfExistingAncestor } from "../shared/git-exclude.js";
import { resolveSidecarOut } from "../shared/sidecar-out.js";
import { parseGrant, verifyGrantSignature } from "../grant/verify.js";
import { checkLines, type LineVerdict } from "./check.js";

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
  /** Milliseconds to wait for the trace lock (default 15 s). */
  readonly lockTimeoutMs?: number;
  /** Test seam: replaces the atomic write of `tip.json`. */
  /** Test seam: runs after the trace and tip were validated, before anything is written, with the trace lock held. */
  readonly beforeTipWrite?: () => Promise<void>;
  /** Test seam: runs after the output directory is validated, before the temp file is created. */
  readonly beforeWrite?: () => Promise<void>;
  /** Test seam: runs after the temp bundle is written, before it is linked. */
  readonly beforeLink?: () => Promise<void>;
  readonly writeTip?: (target: string, data: string) => Promise<void>;
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

/**
 * The real path of `dir`, which must lie under the real `<root>/.hexagen/` and
 * not under its `evidence/` directory. Throws otherwise.
 */
async function realOutDirInsideSidecar(
  root: string,
  dir: string,
): Promise<string> {
  const realDir = await fs.realpath(dir);
  const sidecar = await fs.realpath(path.join(root, ".hexagen"));
  const inside = (base: string, target: string): boolean => {
    const rel = path.relative(base, target);
    return rel === "" || !(rel.startsWith("..") || path.isAbsolute(rel));
  };
  if (!inside(sidecar, realDir)) {
    throw new Error(`${dir} resolves outside ${sidecar}`);
  }
  if (inside(path.join(sidecar, "evidence"), realDir)) {
    throw new Error(`${dir} resolves into the evidence directory`);
  }
  return realDir;
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
  const evidenceDir = path.join(root, ".hexagen", "evidence");
  const underEvidence = async (): Promise<boolean> => {
    const inside = (base: string, target: string): boolean => {
      const rel = path.relative(base, target);
      return rel === "" || !(rel.startsWith("..") || path.isAbsolute(rel));
    };
    if (inside(evidenceDir, out)) return true;
    const realEvidence = await realpathOfExistingAncestor(evidenceDir);
    return inside(realEvidence, await realpathOfExistingAncestor(out));
  };
  if (await underEvidence()) {
    return usage(
      `--out must not be under ${evidenceDir}: the bundle must never replace the evidence it verified`,
    );
  }
  const relOut = path.relative(root, out).split(path.sep).join("/");
  if (new RegExp(BUNDLE_FORBIDDEN_PATH_PATTERN).test(relOut)) {
    return usage(`--out "${relOut}" names a key or env file; refusing`);
  }
  if (
    await fs.lstat(out).then(
      () => true,
      () => false,
    )
  ) {
    return usage(`--out ${out} already exists; refusing to replace it`);
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

  const grants = new Map<string, Grant>();
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
    const checked = parseGrant(parsed, file);
    if (!checked.ok) {
      grantProblems.push(checked.problem);
      continue;
    }
    const g = checked.grant;
    if (grantTexts.has(g.id)) {
      return usage(`grant id '${g.id}' is given twice`);
    }
    grantTexts.set(g.id, text);
    const signature = verifyGrantSignature(g, {
      workspaceRoot: root,
      keyFile: options.keyFile,
      engagement: options.engagement,
      env,
      homeDir: options.homeDir,
    });
    if (!signature.verified) {
      grantProblems.push(
        `grant '${g.id}' (${file}): signature does not verify with the engagement key (${signature.reason})`,
      );
      continue;
    }
    grants.set(g.id, g);
  }

  // Everything from here to the tip write runs under the trace lock: a
  // half-finished append is never read, and two packs cannot interleave their
  // tip read and tip write, which could move the tip backwards.
  const locked = async (): Promise<EvidencePackResult> => {
    const traceBytes = await fs.readFile(tracePath);
    const split = splitTrace(traceBytes.toString("utf8"));
    if (split.lines.length === 0) {
      return usage("the trace has no lines; there is nothing to pack");
    }
    const problems: string[] = [...grantProblems];
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
    let previousTip: { seq: number; hash: string } | null = null;
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
          problems.push(
            "tip.json HMAC does not verify with the engagement key",
          );
        } else {
          tipChecked = true;
          previousTip = { seq: tip.seq, hash: tip.hash };
          const at = split.lines[tip.seq];
          if (at === undefined) {
            problems.push(
              `the trace ends before the recorded tip (seq ${tip.seq}): lines were removed`,
            );
          } else if (
            at.value === undefined ||
            lineHash(at.value) !== tip.hash
          ) {
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
      previousTip,
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
    try {
      const index = BundleIndex.parse({
        ...indexBody,
        hmac: signBundleIndex(indexBody, keyHex),
      });
      entries.unshift({
        name: "bundle.json",
        content: `${JSON.stringify(index, null, 2)}\n`,
      });
      await options.beforeTipWrite?.();
      const outDir = path.dirname(out);
      await fs.mkdir(outDir, { recursive: true });
      // The preflight above ran before anything was created; a directory in the
      // chain may have been swapped for a symlink since. Re-resolve the real
      // directory now, and again just before the link.
      const realOutDir = await realOutDirInsideSidecar(root, outDir);
      await options.beforeWrite?.();
      // Temp file in the validated directory, then a hard link: link fails with
      // EEXIST rather than replacing, so a bundle that was already there is never
      // overwritten. The temp is checked to be the file we made before it is
      // linked. Residual window: a swap between the final realpath check and the
      // link syscall itself, which needs write access to the sidecar directory.
      const tmp = path.join(
        outDir,
        `.${path.basename(out)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
      );
      try {
        const handle = await fs.open(tmp, "wx");
        let tmpIno: number | bigint;
        try {
          await handle.writeFile(writeZipStore(entries));
          tmpIno = (await handle.stat()).ino;
        } finally {
          await handle.close();
        }
        await options.beforeLink?.();
        if ((await realOutDirInsideSidecar(root, outDir)) !== realOutDir) {
          throw new Error(`${outDir} moved while the bundle was being written`);
        }
        if ((await fs.lstat(tmp)).ino !== tmpIno) {
          throw new Error(
            "the temporary bundle was replaced; refusing to link it",
          );
        }
        await fs.link(tmp, out);
      } finally {
        await fs.unlink(tmp).catch(() => undefined);
      }
      // From here `out` is ours, so rolling it back cannot touch anyone else's.
      try {
        await (options.writeTip ?? writeFileReplace)(
          tipPath,
          `${JSON.stringify(newTip, null, 2)}\n`,
        );
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
        `new tip (record it out of band): seq ${newTip.seq} hash ${newTip.hash} hmac ${newTip.hmac}`,
      ],
      verdicts,
      bundle: out,
    };
  };
  try {
    return await withTraceLock(tracePath, locked, {
      timeoutMs: options.lockTimeoutMs,
    });
  } catch (error) {
    // A lock that cannot be taken, or a trace that vanished or became
    // unreadable, is a precondition failure (2), not invalid evidence (1).
    return usage(
      `cannot read the trace under its lock: ${(error as Error).message}`,
    );
  }
}
