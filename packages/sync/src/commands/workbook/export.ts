import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BROWNFIELD_SCHEMA_VERSION,
  BundleIndex,
  Contract,
  ObservedReport,
  ProposalMeta,
  Slice,
} from "@hexagen/shared";
import {
  readGrantKey,
  readSliceEngagementId,
  resolveGrantKey,
} from "@hexagen/shared/node/grant-key";
import {
  signBundleIndex,
  verifyBundleIndex,
} from "@hexagen/shared/node/trace-chain";
import { writeZipStore, type ZipEntry } from "../report/zip-store.js";
import { realpathOfExistingAncestor } from "../shared/git-exclude.js";
import { resolveSidecarOut } from "../shared/sidecar-out.js";
import { parseGrant, verifyGrantSignature } from "../grant/verify.js";
import { runEvidencePack } from "../evidence/pack.js";
import {
  allowListEntry,
  bundlePathAllowed,
  isForbiddenPath,
  type AllowedFile,
  type BundleRole,
} from "./allow-list.js";
import {
  inside,
  listDir,
  openSidecar,
  readAllowed,
  Refusal,
  type Sidecar,
} from "../shared/grant-enumerator.js";
import { readZipStore } from "./zip-read.js";

export interface WorkbookExportOptions {
  /** Repo root; `.hexagen/` lives here. Never searched upward. */
  readonly root: string;
  /** Bundle path, under `<root>/.hexagen/` and not under `evidence/`. */
  readonly out?: string;
  /** Stage mode: allow-listed files to `git add -f` into the client's history. */
  readonly stage?: readonly string[];
  /** Confirms the staging (stage mode only). */
  readonly yes?: boolean;
  readonly keyFile?: string;
  readonly engagement?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Test seam; defaults to `os.homedir()`. */
  readonly homeDir?: string;
  readonly now?: () => Date;
  /** Test seam: runs after the temporary pack was written, before it is read back. */
  readonly afterPack?: (zipPath: string) => Promise<void>;
  /** Test seam: runs after a file was validated, before it is opened. */
  readonly afterValidate?: (file: string) => Promise<void>;
  /** Test seam: runs after the stage files were read, before the preview is computed. */
  readonly beforePreview?: () => Promise<void>;
  /** Test seam: runs after the stage preview, before anything is staged. */
  readonly beforeStage?: () => Promise<void>;
}

export interface WorkbookExportResult {
  /** 0 done; 1 the evidence or a grant is invalid (nothing written); 2 usage, refusal or precondition. */
  readonly exitCode: 0 | 1 | 2;
  readonly messages: readonly string[];
  /** Absolute path of the bundle, when one was written. */
  readonly bundle?: string;
  /** Repo-relative paths staged (stage mode with --yes). */
  readonly staged?: readonly string[];
}

const sha256 = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

async function realOutDirInsideSidecar(
  sc: Sidecar,
  dir: string,
): Promise<string> {
  const realDir = await fs.realpath(dir);
  if (!inside(sc.real, realDir)) {
    throw new Error(`${dir} resolves outside ${sc.real}`);
  }
  if (inside(path.join(sc.real, "evidence"), realDir)) {
    throw new Error(`${dir} resolves into the evidence directory`);
  }
  return realDir;
}

async function validateOut(sc: Sidecar, outOption: string): Promise<string> {
  const out = await resolveSidecarOut(sc.root, outOption).catch(() => null);
  if (!out) {
    throw new Refusal(
      `--out must name a file under ${sc.dir}${path.sep}; got "${outOption}"`,
    );
  }
  const evidenceDir = path.join(sc.dir, "evidence");
  if (
    inside(evidenceDir, out) ||
    inside(
      await realpathOfExistingAncestor(evidenceDir),
      await realpathOfExistingAncestor(out),
    )
  ) {
    throw new Refusal(
      `--out must not be under ${evidenceDir}: the bundle must never replace the evidence it carries`,
    );
  }
  const relOut = path.relative(sc.root, out).split(path.sep).join("/");
  if (isForbiddenPath(relOut)) {
    throw new Refusal(`--out "${relOut}" names a key or env file; refusing`);
  }
  if (
    await fs.lstat(out).then(
      () => true,
      () => false,
    )
  ) {
    throw new Refusal(`--out ${out} already exists; refusing to replace it`);
  }
  return out;
}

interface Collected {
  readonly entries: ZipEntry[];
  readonly files: BundleIndex["files"];
  readonly notes: string[];
}

function add(
  c: { entries: ZipEntry[]; files: BundleIndex["files"][number][] },
  bundlePath: string,
  role: BundleRole,
  content: Buffer | string,
): void {
  // Second check: the path as it will be named inside the bundle.
  if (!bundlePathAllowed(bundlePath)) {
    throw new Refusal(
      `bundle path ${bundlePath} is not allow-listed; refusing`,
    );
  }
  c.entries.push({ name: bundlePath, content });
  c.files.push({ path: bundlePath, role, sha256: sha256(content) });
}

async function runExport(
  options: WorkbookExportOptions,
  sc: Sidecar,
  outOption: string,
): Promise<WorkbookExportResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const out = await validateOut(sc, outOption);

  const sliceRead = await readAllowed(
    sc,
    allowListEntry("slice.json") as AllowedFile,
  ).catch((error: unknown) => {
    if (
      error instanceof Refusal &&
      error.message === "slice.json: does not exist"
    ) {
      throw new Refusal(
        ".hexagen/slice.json is required: run `hexagen slice init` first",
      );
    }
    throw error;
  });
  let slice: Slice;
  try {
    slice = Slice.parse(JSON.parse(sliceRead.text.toString("utf8")));
  } catch (error) {
    throw new Refusal(
      `.hexagen/slice.json is not a valid slice: ${(error as Error).message}`,
    );
  }

  const resolved = resolveGrantKey({
    keyFile: options.keyFile,
    env,
    engagementId: options.engagement ?? readSliceEngagementId(sc.root),
    workspaceRoot: sc.root,
    homeDir: options.homeDir,
  });
  if (resolved.path === null) {
    throw new Refusal(`cannot locate the engagement key: ${resolved.problem}`);
  }
  const key = readGrantKey(resolved.path);
  if (!key.ok) throw new Refusal(`engagement key unusable: ${key.problem}`);

  const c: Collected & {
    entries: ZipEntry[];
    files: BundleIndex["files"][number][];
  } = {
    entries: [],
    files: [],
    notes: [],
  };
  add(c, "slice.json", "slice", sliceRead.text);

  const optional: Array<[string, BundleRole, (j: unknown) => unknown]> = [
    ["observed.json", "observed", (j) => ObservedReport.parse(j)],
    ["contract.json", "contract", (j) => Contract.parse(j)],
  ];
  for (const [name, role, parse] of optional) {
    const entry = allowListEntry(name) as AllowedFile;
    if (
      !(await fs.lstat(path.join(sc.dir, name)).then(
        () => true,
        () => false,
      ))
    ) {
      c.notes.push(`note: .hexagen/${name} is absent; the bundle omits it`);
      continue;
    }
    const read = await readAllowed(sc, entry);
    try {
      parse(JSON.parse(read.text.toString("utf8")));
    } catch (error) {
      throw new Refusal(
        `.hexagen/${name} is not valid: ${(error as Error).message}`,
      );
    }
    add(c, name, role, read.text);
  }

  // Bundle directories: a key or env file lying in one is refused outright;
  // any other file that is not allow-listed is skipped with a note.
  const grantFiles: string[] = [];
  const grantProblems: string[] = [];
  for (const sub of ["grants", "proposals"] as const) {
    for (const name of await listDir(sc, sub)) {
      const rel = `${sub}/${name}`;
      if (isForbiddenPath(rel)) {
        throw new Refusal(
          `.hexagen/${rel}: a key or env file in a bundle directory; refusing the export`,
        );
      }
      const entry = allowListEntry(rel);
      if (entry === null) {
        c.notes.push(`note: skipped .hexagen/${rel} (not allow-listed)`);
        continue;
      }
      const read = await readAllowed(sc, entry);
      if (sub === "grants") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(read.text.toString("utf8"));
        } catch {
          grantProblems.push(`.hexagen/${rel} is not valid JSON`);
          continue;
        }
        const checked = parseGrant(parsed, `.hexagen/${rel}`);
        if (!checked.ok) {
          grantProblems.push(checked.problem);
          continue;
        }
        const signature = verifyGrantSignature(checked.grant, {
          workspaceRoot: sc.root,
          keyFile: options.keyFile,
          engagement: options.engagement,
          env,
          homeDir: options.homeDir,
        });
        if (!signature.verified) {
          grantProblems.push(
            `grant '${checked.grant.id}' (.hexagen/${rel}): signature does not verify with the engagement key (${signature.reason})`,
          );
          continue;
        }
        grantFiles.push(read.file);
      } else if (entry.bundlePath.endsWith(".json")) {
        try {
          ProposalMeta.parse(JSON.parse(read.text.toString("utf8")));
        } catch (error) {
          throw new Refusal(
            `.hexagen/${rel} is not valid proposal metadata: ${(error as Error).message}`,
          );
        }
      }
      add(c, entry.bundlePath, entry.role, read.text);
    }
  }
  if (grantProblems.length > 0) {
    return {
      exitCode: 1,
      messages: [
        "workbook export FAILED; no bundle written:",
        ...grantProblems.map((p) => `  - ${p}`),
      ],
    };
  }

  // Evidence: run the pack logic (it verifies the chain, the anchored tip and
  // every grant rule) into a temporary file, and take its entries. A failed
  // pack fails the export.
  const trace = path.join(sc.dir, "evidence", "trace.jsonl");
  if (
    await fs.lstat(trace).then(
      () => true,
      () => false,
    )
  ) {
    if (grantFiles.length === 0) {
      throw new Refusal(
        "the trace exists but .hexagen/grants/ holds no verified grant; export cannot pack it",
      );
    }
    const tmpName = `.workbook-pack-${process.pid}-${randomBytes(4).toString("hex")}.zip`;
    const tmpRel = `.hexagen/${tmpName}`;
    const tmpAbs = path.join(sc.dir, tmpName);
    try {
      const pack = await runEvidencePack({
        root: sc.root,
        trace,
        grantFiles,
        out: tmpRel,
        keyFile: options.keyFile,
        engagement: options.engagement,
        env,
        homeDir: options.homeDir,
        now,
      });
      if (pack.exitCode !== 0) {
        return {
          exitCode: pack.exitCode,
          messages: [
            "workbook export FAILED; no bundle written:",
            ...pack.messages,
          ],
        };
      }
      const tampered = (why: string) => ({
        exitCode: 1 as const,
        messages: [
          "workbook export FAILED; no bundle written:",
          `  - the temporary evidence pack failed re-verification (${why})`,
        ],
      });
      await options.afterPack?.(tmpAbs);
      // Re-verify the pack before adopting anything from it: its own index
      // must verify with the engagement key, and each adopted entry must match
      // the index's sha256.
      let zip: Map<string, Buffer>;
      try {
        zip = readZipStore(await fs.readFile(tmpAbs));
      } catch (error) {
        return tampered(`unreadable: ${(error as Error).message}`);
      }
      let packIndex: BundleIndex;
      try {
        packIndex = BundleIndex.parse(
          JSON.parse(
            (zip.get("bundle.json") ?? Buffer.alloc(0)).toString("utf8"),
          ),
        );
      } catch {
        return tampered("its bundle.json is missing or invalid");
      }
      if (!verifyBundleIndex(packIndex as never, key.keyHex)) {
        return tampered("its bundle.json HMAC does not verify");
      }
      for (const [name, role, target] of [
        ["evidence/trace.jsonl", "evidence", "evidence/trace.jsonl"],
        ["evidence/verdicts.json", "evidence", "evidence/verdicts.json"],
        ["evidence/tip.json", "tip", "tip.json"],
      ] as const) {
        const content = zip.get(name);
        if (content === undefined) return tampered(`it lacks ${name}`);
        const listed = packIndex.files.find((e) => e.path === name);
        if (listed === undefined || listed.sha256 !== sha256(content)) {
          return tampered(`${name} does not match the pack's index`);
        }
        add(c, target, role, content);
      }
      c.notes.push(
        ...pack.messages.filter((m) => m.startsWith("evidence pack ok")),
      );
    } finally {
      await fs.unlink(tmpAbs).catch(() => undefined);
    }
  } else if (
    await fs.lstat(path.join(sc.dir, "evidence", "tip.json")).then(
      () => true,
      () => false,
    )
  ) {
    return {
      exitCode: 1,
      messages: [
        "workbook export FAILED; no bundle written:",
        "  - evidence/tip.json exists but trace.jsonl is missing; the trace was removed or truncated",
      ],
    };
  } else {
    c.notes.push(
      "note: .hexagen/evidence/trace.jsonl is absent; the bundle carries no evidence",
    );
  }

  const indexBody = {
    schemaVersion: BROWNFIELD_SCHEMA_VERSION,
    createdAt: now().toISOString(),
    sliceId: slice.id,
    files: c.files,
  };
  const index = BundleIndex.parse({
    ...indexBody,
    hmac: signBundleIndex(indexBody, key.keyHex),
  });
  const entries: ZipEntry[] = [
    { name: "bundle.json", content: `${JSON.stringify(index, null, 2)}\n` },
    ...c.entries,
  ];

  const outDir = path.dirname(out);
  await fs.mkdir(outDir, { recursive: true });
  const realOutDir = await realOutDirInsideSidecar(sc, outDir);
  const tmp = path.join(
    outDir,
    `.${path.basename(out)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  try {
    const handle = await fs.open(tmp, "wx");
    let ino: number | bigint;
    try {
      await handle.writeFile(writeZipStore(entries));
      ino = (await handle.stat()).ino;
    } finally {
      await handle.close();
    }
    if ((await realOutDirInsideSidecar(sc, outDir)) !== realOutDir) {
      throw new Error(`${outDir} moved while the bundle was being written`);
    }
    if ((await fs.lstat(tmp)).ino !== ino) {
      throw new Error("the temporary bundle was replaced; refusing to link it");
    }
    // link fails with EEXIST instead of replacing: never an overwrite.
    await fs.link(tmp, out);
  } catch (error) {
    throw new Refusal(
      `could not write the bundle: ${(error as Error).message}`,
    );
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
  return {
    exitCode: 0,
    messages: [
      ...c.notes,
      `workbook export ok: ${c.files.length} file(s), slice ${slice.id}`,
      `bundle: ${out}`,
    ],
    bundle: out,
  };
}

function git(root: string, args: string[], input?: Buffer): string {
  return execFileSync("git", args, {
    input,
    cwd: root,
    encoding: "utf8",
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_LITERAL_PATHSPECS: "1",
      GIT_OPTIONAL_LOCKS: "0",
    },
  });
}

/**
 * Unified diff of the HEAD blob against the pinned bytes, both written to a
 * scratch directory outside the client tree. Headers read `a/<path> b/<path>`.
 */
async function diffAgainstHead(
  root: string,
  repoRel: string,
  bytes: Buffer,
): Promise<string> {
  const headBytes = execFileSync(
    "git",
    ["cat-file", "blob", `HEAD:${repoRel}`],
    {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_LITERAL_PATHSPECS: "1",
        GIT_OPTIONAL_LOCKS: "0",
      },
    },
  );
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-stage-"));
  try {
    for (const [side, content] of [
      ["a", headBytes],
      ["b", bytes],
    ] as const) {
      const target = path.join(tmp, side, ...repoRel.split("/"));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content);
    }
    try {
      execFileSync(
        "git",
        [
          "diff",
          "--no-index",
          "--no-color",
          "--src-prefix=",
          "--dst-prefix=",
          "--",
          `a/${repoRel}`,
          `b/${repoRel}`,
        ],
        { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      return ""; // identical
    } catch (error) {
      // --no-index exits 1 when the files differ; the diff is on stdout.
      const e = error as { status?: number; stdout?: string };
      if (e.status === 1 && typeof e.stdout === "string") return e.stdout;
      throw error;
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

function newFileDiff(rel: string, text: string): string {
  const lines = text.split("\n");
  const endsWithNewline = text.endsWith("\n");
  if (endsWithNewline) lines.pop();
  const body = lines.map((l) => `+${l}`).join("\n");
  const head = `diff --git a/${rel} b/${rel}\nnew file mode 100644\n--- /dev/null\n+++ b/${rel}\n`;
  if (lines.length === 0) return head;
  return `${head}@@ -0,0 +1,${lines.length} @@\n${body}\n${endsWithNewline ? "" : "\\ No newline at end of file\n"}`;
}

async function runStage(
  options: WorkbookExportOptions,
  sc: Sidecar,
  files: readonly string[],
): Promise<WorkbookExportResult> {
  const accepted: Array<{ repoRel: string; bytes: Buffer }> = [];
  const refusals: string[] = [];
  const seen = new Set<string>();
  for (const given of files) {
    const abs = path.resolve(sc.root, given);
    const relToSidecar = path.relative(sc.dir, abs);
    if (
      relToSidecar === "" ||
      relToSidecar.startsWith("..") ||
      path.isAbsolute(relToSidecar)
    ) {
      refusals.push(`${given}: not a file under ${sc.dir}${path.sep}`);
      continue;
    }
    const entry = allowListEntry(relToSidecar);
    if (entry === null) {
      refusals.push(
        isForbiddenPath(relToSidecar)
          ? `${given}: names a key or env file; refusing`
          : `${given}: not on the export allow-list`,
      );
      continue;
    }
    if (seen.has(entry.source)) continue;
    seen.add(entry.source);
    try {
      const read = await readAllowed(sc, entry);
      accepted.push({
        repoRel: `.hexagen/${entry.source}`,
        bytes: read.text,
      });
    } catch (error) {
      refusals.push(`${given}: ${(error as Error).message}`);
    }
  }
  if (refusals.length > 0) {
    return {
      exitCode: 2,
      messages: [
        "workbook export --stage refused; nothing was staged:",
        ...refusals.map((r) => `  - ${r}`),
      ],
    };
  }

  await options.beforePreview?.();
  const parts: string[] = [];
  try {
    for (const f of accepted) {
      // Against HEAD, from the pinned bytes, so a change already sitting in the index is shown too.
      const inHead = (() => {
        try {
          git(sc.root, ["cat-file", "-e", `HEAD:${f.repoRel}`]);
          return true;
        } catch {
          return false;
        }
      })();
      parts.push(
        inHead
          ? (await diffAgainstHead(sc.root, f.repoRel, f.bytes)) ||
              `(${f.repoRel} is already tracked and unchanged)\n`
          : newFileDiff(f.repoRel, f.bytes.toString("utf8")),
      );
    }
  } catch (error) {
    return {
      exitCode: 2,
      messages: [`git failed in ${sc.root}: ${(error as Error).message}`],
    };
  }
  const diff = parts.join("");
  const names = accepted.map((f) => f.repoRel);
  if (options.yes !== true) {
    return {
      exitCode: 0,
      messages: [
        diff.trimEnd(),
        "",
        `will stage (as git add -f would): ${names.join(", ")}`,
        "nothing was staged. Re-run with --yes to stage exactly these files into this repo's history.",
      ],
      staged: [],
    };
  }
  try {
    await options.beforeStage?.();
    // Stage the previewed bytes themselves, not whatever the path holds now:
    // the equivalent of `git add -f`, pinned to the bytes that were shown.
    for (const f of accepted) {
      const sha = git(
        sc.root,
        ["hash-object", "-w", "--stdin"],
        f.bytes,
      ).trim();
      git(sc.root, [
        "update-index",
        "--add",
        "--cacheinfo",
        `100644,${sha},${f.repoRel}`,
      ]);
    }
  } catch (error) {
    return {
      exitCode: 2,
      messages: [`git add failed: ${(error as Error).message}`],
    };
  }
  return {
    exitCode: 0,
    messages: [
      diff.trimEnd(),
      "",
      `staged (git add -f equivalent): ${names.join(", ")}`,
      "commit them yourself; nothing was committed.",
    ],
    staged: names,
  };
}

/**
 * `hexagen workbook export`: writes the workbook bundle (plan §4.8) from an
 * allow-list, or, with `--stage`, stages exactly the named allow-listed files
 * into the client's history after showing the diff (BW-D1). It never touches
 * the client's working tree.
 */
export async function runWorkbookExport(
  options: WorkbookExportOptions,
): Promise<WorkbookExportResult> {
  const root = path.resolve(options.root);
  try {
    if (options.out !== undefined && (options.stage?.length ?? 0) > 0) {
      throw new Refusal("--out and --stage are separate modes; give one");
    }
    if (options.out === undefined && (options.stage?.length ?? 0) === 0) {
      throw new Refusal(
        "give --out <zip> to write a bundle, or --stage <file...> to stage files",
      );
    }
    const sc = await openSidecar(
      root,
      options.homeDir ?? os.homedir(),
      options.afterValidate,
    );
    if (options.out !== undefined)
      return await runExport(options, sc, options.out);
    return await runStage(options, sc, options.stage ?? []);
  } catch (error) {
    if (error instanceof Refusal) {
      return { exitCode: error.exitCode, messages: [error.message] };
    }
    return {
      exitCode: 2,
      messages: [`workbook export failed: ${(error as Error).message}`],
    };
  }
}
