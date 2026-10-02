import { randomBytes } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  BROWNFIELD_SCHEMA_VERSION,
  BUILTIN_RULE_IDS,
  Contract,
  edgesComplete,
  normalizeSlicePath,
} from "@hexagen/shared";
import { isValidEngagementId } from "@hexagen/shared/node/grant-key";
import { ensureExcluded } from "../shared/git-exclude.js";
import { resolveSidecarOut } from "../shared/sidecar-out.js";
import {
  writeFileExclusive,
  writeFileReplace,
} from "../shared/sidecar-write.js";
import {
  UsageError,
  contractPath,
  listWorkTreeFiles,
  loadContract,
  loadObserved,
  loadSlice,
  preflight,
  staleInputs,
  type CommandResult,
} from "../shared/brownfield-sidecar.js";
import { asResult, type SliceRootOptions } from "../slice/index.js";
import {
  evaluateContract,
  isKnown,
  proposeCrossPrefixEdges,
} from "./evaluate.js";

const pretty = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;

export async function runContractPropose(
  options: SliceRootOptions & { strict?: boolean },
): Promise<CommandResult> {
  const messages: string[] = [];
  try {
    const root = path.resolve(options.root);
    const slice = await loadSlice(root);
    const observed = await loadObserved(root);
    const stale = staleInputs(root, slice, observed, options.strict === true);
    messages.push(...stale.warnings);
    if (stale.problems.length > 0) {
      messages.push(...stale.problems);
      return { exitCode: 2, messages };
    }
    if (!edgesComplete(observed.edges)) {
      messages.push(
        "note: the edge list is incomplete (see `hexagen slice check`); these candidates are not the whole picture",
      );
    }
    const found = proposeCrossPrefixEdges(slice, observed);
    const lines =
      found.length === 0
        ? ["no cross-prefix edges inside the slice"]
        : found.flatMap((c) => [
            `${c.from} -> ${c.to}  (${c.count} edge${c.count === 1 ? "" : "s"}; e.g. ${c.example})`,
            `    hexagen contract add-rule --kind forbid --from ${c.from} --to ${c.to}`,
          ]);
    return {
      exitCode: 0,
      messages,
      stdout: `candidate rules for slice ${slice.id} (nothing written):\n${lines.join("\n")}\n`,
    };
  } catch (e) {
    return asResult(e, messages);
  }
}

export interface AddRuleOptions extends SliceRootOptions {
  kind: "forbid" | "allow-only";
  from: string;
  to: string;
  severity?: "error" | "warn";
  id?: string;
  yes?: boolean;
}

async function writeContract(
  root: string,
  contract: Contract,
  create: boolean,
  yes: boolean | undefined,
  messages: string[],
): Promise<void> {
  const target = await resolveSidecarOut(root, ".hexagen/contract.json");
  if (!target) throw new UsageError(".hexagen/contract.json is not writable");
  const { applyExclude } = await preflight(root, [target], yes, messages);
  // The exclude is updated first: if it fails, contract.json is not touched.
  if (applyExclude) await ensureExcluded(root, ".hexagen/");
  const text = pretty(Contract.parse(contract));
  if (create) await writeFileExclusive(target, text);
  else await writeFileReplace(target, text);
  messages.push(`wrote ${target}`);
}

async function contractExists(root: string): Promise<boolean> {
  return lstat(contractPath(root)).then(
    () => true,
    () => false,
  );
}

export async function runContractAddRule(
  options: AddRuleOptions,
): Promise<CommandResult> {
  const messages: string[] = [];
  try {
    const root = path.resolve(options.root);
    if (options.kind !== "forbid" && options.kind !== "allow-only") {
      throw new UsageError("--kind must be forbid or allow-only");
    }
    const severity = options.severity ?? "error";
    if (severity !== "error" && severity !== "warn") {
      throw new UsageError("--severity must be error or warn");
    }
    for (const [flag, value] of [
      ["--from", options.from],
      ["--to", options.to],
    ] as const) {
      const check = normalizeSlicePath(value);
      if (!check.ok)
        throw new UsageError(`${flag} "${value}": ${check.reason}`);
    }
    const id = options.id ?? `rule-${randomBytes(4).toString("hex")}`;
    if (BUILTIN_RULE_IDS.includes(id)) {
      throw new UsageError(`rule id "${id}" is reserved for a built-in rule`);
    }
    if (!isValidEngagementId(id)) {
      throw new UsageError(
        `invalid --id "${id}": use A-Z a-z 0-9 . _ - (1-64 chars, no "..")`,
      );
    }
    const slice = await loadSlice(root);
    const existing = await loadContract(root);
    if (existing && existing.sliceId !== slice.id) {
      throw new UsageError(
        `contract.json is for slice "${existing.sliceId}", but slice.json is "${slice.id}"`,
      );
    }
    if (existing?.rules.some((r) => r.id === id)) {
      throw new UsageError(`a rule with id "${id}" already exists`);
    }
    const contract: Contract = existing ?? {
      schemaVersion: BROWNFIELD_SCHEMA_VERSION,
      sliceId: slice.id,
      rules: [],
      knownViolations: [],
    };
    const next: Contract = {
      ...contract,
      rules: [
        ...contract.rules,
        {
          id,
          kind: options.kind,
          from: options.from,
          to: options.to,
          severity,
        },
      ],
    };
    await writeContract(
      root,
      next,
      existing === undefined,
      options.yes,
      messages,
    );
    messages.push(`added rule ${id}`);
    return { exitCode: 0, messages };
  } catch (e) {
    return asResult(e, messages);
  }
}

export async function runContractShow(
  options: SliceRootOptions,
): Promise<CommandResult> {
  const messages: string[] = [];
  try {
    const contract = await loadContract(path.resolve(options.root));
    if (!contract)
      throw new UsageError(
        "contract does not exist: run `hexagen contract add-rule`",
      );
    return { exitCode: 0, messages, stdout: pretty(contract) };
  } catch (e) {
    return asResult(e, messages);
  }
}

export interface ContractCheckOptions extends SliceRootOptions {
  baseline?: boolean;
  yes?: boolean;
  strict?: boolean;
}

export async function runContractCheck(
  options: ContractCheckOptions,
): Promise<CommandResult> {
  const messages: string[] = [];
  try {
    const root = path.resolve(options.root);
    const slice = await loadSlice(root);
    const contract = await loadContract(root);
    if (contract && contract.sliceId !== slice.id) {
      throw new UsageError(
        `contract.json is for slice "${contract.sliceId}", but slice.json is "${slice.id}"`,
      );
    }
    const observed = await loadObserved(root);
    const stale = staleInputs(root, slice, observed, options.strict === true);
    messages.push(...stale.warnings);
    if (stale.problems.length > 0) {
      messages.push(...stale.problems);
      return { exitCode: 2, messages };
    }
    const { violations, incomplete } = evaluateContract({
      slice,
      contract,
      observed,
      files: listWorkTreeFiles(root),
    });

    if (options.baseline) {
      if (incomplete !== null) {
        throw new UsageError(
          `cannot baseline: ${incomplete}; re-run \`hexagen observe\``,
        );
      }
      const failing = violations.filter((v) => v.severity === "error");
      const base: Contract = contract ?? {
        schemaVersion: BROWNFIELD_SCHEMA_VERSION,
        sliceId: slice.id,
        rules: [],
        knownViolations: [],
      };
      const known = failing.map((v) => {
        const prior = base.knownViolations.find(
          (k) =>
            k.rule === v.rule &&
            k.file === v.file &&
            k.specifier === v.specifier,
        );
        return {
          ...(prior ?? {}),
          rule: v.rule,
          file: v.file,
          specifier: v.specifier,
        };
      });
      await writeContract(
        root,
        { ...base, knownViolations: known },
        contract === undefined,
        options.yes,
        messages,
      );
      messages.push(`baselined ${known.length} violation(s)`);
      return { exitCode: 0, messages };
    }

    const lines: string[] = [];
    let failing = 0;
    let known = 0;
    for (const v of violations) {
      if (isKnown(contract, v)) {
        known++;
        continue;
      }
      if (v.severity === "error") failing++;
      lines.push(
        `${v.severity === "error" ? "violation" : "warning"}: ${v.rule}  ${v.file}  ${v.specifier}`,
      );
    }
    if (incomplete !== null) {
      failing++;
      lines.unshift(
        `incomplete: ${incomplete}, so the slice's imports cannot be checked; re-run \`hexagen observe\``,
      );
    }
    if (known > 0) messages.push(`${known} known violation(s) in the baseline`);
    if (failing === 0) {
      messages.push(`contract for slice ${slice.id}: clean`);
      return {
        exitCode: 0,
        messages,
        ...(lines.length > 0 ? { stdout: `${lines.join("\n")}\n` } : {}),
      };
    }
    return {
      exitCode: 1,
      messages,
      stdout: `${lines.join("\n")}\n`,
    };
  } catch (e) {
    return asResult(e, messages);
  }
}

function emit(result: CommandResult): void {
  for (const line of result.messages) console.error(line);
  if (result.stdout !== undefined) process.stdout.write(result.stdout);
  process.exitCode = result.exitCode;
}

const ROOT_FLAG = "--root <dir>";
const ROOT_DESC = "Repo top level (defaults to cwd; never searched upward)";
const STRICT_DESC = "Fail (exit 2) when observed.json was not read at HEAD";

export const contractCommander = new Command("contract").description(
  "Rules for a slice, checked against observed import edges: .hexagen/contract.json",
);

contractCommander
  .command("propose")
  .description(
    "List cross-prefix edges inside the slice as candidate rules (writes nothing)",
  )
  .option("--strict", STRICT_DESC)
  .option(ROOT_FLAG, ROOT_DESC)
  .action(async (opts: { root?: string; strict?: boolean }) => {
    emit(
      await runContractPropose({
        root: opts.root ?? process.cwd(),
        strict: opts.strict,
      }),
    );
  });

contractCommander
  .command("add-rule")
  .description("Add a rule to .hexagen/contract.json (requires --yes)")
  .requiredOption("--kind <kind>", "forbid or allow-only")
  .requiredOption("--from <prefix>", "Source path prefix")
  .requiredOption("--to <prefix>", "Target path prefix")
  .option("--severity <severity>", "error (default) or warn")
  .option("--id <id>", "Rule id (not a built-in id); random by default")
  .option(ROOT_FLAG, ROOT_DESC)
  .option("--yes", "Confirm the writes listed by the `will write:` lines")
  .action(
    async (opts: {
      kind: string;
      from: string;
      to: string;
      severity?: string;
      id?: string;
      root?: string;
      yes?: boolean;
    }) => {
      emit(
        await runContractAddRule({
          root: opts.root ?? process.cwd(),
          kind: opts.kind as "forbid" | "allow-only",
          from: opts.from,
          to: opts.to,
          severity: opts.severity as "error" | "warn" | undefined,
          id: opts.id,
          yes: opts.yes,
        }),
      );
    },
  );

contractCommander
  .command("show")
  .description("Print .hexagen/contract.json")
  .option(ROOT_FLAG, ROOT_DESC)
  .action(async (opts: { root?: string }) => {
    emit(await runContractShow({ root: opts.root ?? process.cwd() }));
  });

contractCommander
  .command("check")
  .description(
    "Check the contract against observed.json. Exit 0 clean, 1 violation, 2 bad input or stale observed.json",
  )
  .option(
    "--baseline",
    "Write the current violations to knownViolations (requires --yes)",
  )
  .option("--yes", "Confirm the writes listed by the `will write:` lines")
  .option("--strict", STRICT_DESC)
  .option(ROOT_FLAG, ROOT_DESC)
  .action(
    async (opts: {
      root?: string;
      baseline?: boolean;
      yes?: boolean;
      strict?: boolean;
    }) => {
      emit(
        await runContractCheck({
          root: opts.root ?? process.cwd(),
          baseline: opts.baseline,
          yes: opts.yes,
          strict: opts.strict,
        }),
      );
    },
  );
