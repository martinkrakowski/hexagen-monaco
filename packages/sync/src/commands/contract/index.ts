import { randomBytes } from "node:crypto";
import path from "node:path";
import { Command } from "commander";
import {
  BROWNFIELD_SCHEMA_VERSION,
  BUILTIN_RULE_IDS,
  Contract,
  edgesComplete,
  normalizeSlicePath,
  type ObservedReport,
  type Slice,
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
  asResult,
  listWorkTreeFiles,
  loadContract,
  loadObserved,
  loadSlice,
  preflight,
  staleInputs,
  withContractLock,
  type CommandResult,
} from "../shared/brownfield-sidecar.js";
import { type SliceRootOptions } from "../slice/index.js";
import {
  closedRuleCoverageWarning,
  evaluateContract,
  isKnown,
  isSuppressionExpired,
  proposeClosedExcepts,
  proposeCrossPrefixEdges,
} from "./evaluate.js";

const pretty = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;

/**
 * The candidate `closed` rule, as `propose --closed` prints it: the crossing
 * targets as one `except` list, the `add-rule` line that would write it, and any
 * crossing that gets no entry, with the advice that would accept it. Writes
 * nothing either way.
 */
function closedProposal(slice: Slice, observed: ObservedReport): string {
  const { excepts, notProposed } = proposeClosedExcepts(slice, observed);
  // `--except` with no prefixes at all is a legal rule (it accepts none), so
  // the empty case prints the bare flag rather than dropping it.
  const flags = excepts.length === 0 ? "" : `${excepts.join(" ")} `;
  const lines = [
    "closed: except the crossings observed.json already makes, and delete the ones you do not accept",
    `except: ${JSON.stringify(excepts)}`,
    ...(excepts.length === 0
      ? [
          "no observed edge leaves the slice, so this rule accepts no crossing at all",
        ]
      : []),
    ...notProposed.map((n) => `not proposed: "${n.to}" — ${n.advice}`),
    `    hexagen contract add-rule --kind closed --except ${flags}--yes`,
  ];
  return `candidate rules for slice ${slice.id} (nothing written):\n${lines.join("\n")}\n`;
}

export async function runContractPropose(
  options: SliceRootOptions & { strict?: boolean; closed?: boolean },
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
    if (options.closed === true) {
      return {
        exitCode: 0,
        messages,
        stdout: closedProposal(slice, observed),
      };
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
  /** `closed` takes `except` and no `from`/`to`; the prefix kinds the reverse. */
  kind: "forbid" | "allow-only" | "closed";
  from?: string;
  to?: string;
  /** The accepted crossings of a `closed` rule. `undefined` when the flag was not given, `[]` when it was given with no prefixes. */
  except?: string[];
  severity?: "error" | "warn";
  id?: string;
  yes?: boolean;
}

/**
 * The rule the flags describe, or a `UsageError` naming the one that does not
 * belong to the kind. Kept apart from the writing so each refusal is one guard.
 */
function ruleFromFlags(
  id: string,
  kind: AddRuleOptions["kind"],
  flags: Pick<AddRuleOptions, "from" | "to" | "except">,
  severity: "error" | "warn",
): Contract["rules"][number] {
  const slicePath = (flag: string, value: string): string => {
    const check = normalizeSlicePath(value);
    if (!check.ok) throw new UsageError(`${flag} "${value}": ${check.reason}`);
    return value;
  };
  if (kind === "closed") {
    if (flags.from !== undefined)
      throw new UsageError("--kind closed takes no --from");
    if (flags.to !== undefined)
      throw new UsageError("--kind closed takes no --to");
    if (flags.except === undefined)
      throw new UsageError(
        "--kind closed needs --except <prefix>... (it may be given no prefixes, which accepts no crossing)",
      );
    return {
      id,
      kind,
      except: flags.except.map((entry) => slicePath("--except", entry)),
      severity,
    };
  }
  if (flags.except !== undefined)
    throw new UsageError(`--kind ${kind} takes no --except`);
  if (flags.from === undefined)
    throw new UsageError(`--kind ${kind} needs --from <prefix>`);
  if (flags.to === undefined)
    throw new UsageError(`--kind ${kind} needs --to <prefix>`);
  return {
    id,
    kind,
    from: slicePath("--from", flags.from),
    to: slicePath("--to", flags.to),
    severity,
  };
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

/** Run a read-modify-write under the contract lock when it will write. */
async function locked(
  root: string,
  willWrite: boolean,
  fn: () => Promise<CommandResult>,
): Promise<CommandResult> {
  if (!willWrite) return fn();
  try {
    return await withContractLock(path.resolve(root), fn);
  } catch (e) {
    return asResult(e, []);
  }
}

export function runContractAddRule(
  options: AddRuleOptions,
): Promise<CommandResult> {
  return locked(options.root, options.yes === true, () => addRule(options));
}

async function addRule(options: AddRuleOptions): Promise<CommandResult> {
  const messages: string[] = [];
  try {
    const root = path.resolve(options.root);
    if (
      options.kind !== "forbid" &&
      options.kind !== "allow-only" &&
      options.kind !== "closed"
    ) {
      throw new UsageError("--kind must be forbid, allow-only or closed");
    }
    const severity = options.severity ?? "error";
    if (severity !== "error" && severity !== "warn") {
      throw new UsageError("--severity must be error or warn");
    }
    const id = options.id ?? `rule-${randomBytes(4).toString("hex")}`;
    const rule = ruleFromFlags(id, options.kind, options, severity);
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
      rules: [...contract.rules, rule],
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
    const root = path.resolve(options.root);
    const contract = await loadContract(root);
    if (!contract)
      throw new UsageError(
        "contract does not exist: run `hexagen contract add-rule`",
      );
    // Only a `closed` rule can accept a crossing, so only then is the scan read.
    if (contract.rules.some((r) => r.kind === "closed")) {
      const said = await coverageMessage(root, contract);
      if (said !== null) messages.push(said);
    }
    return { exitCode: 0, messages, stdout: pretty(contract) };
  } catch (e) {
    return asResult(e, messages);
  }
}

/**
 * The coverage warning for the contract's `closed` rules, or a note saying the
 * check could not run. Best-effort: `show` prints the contract whether or not a
 * scan was staged, so an unreadable `slice.json`/`observed.json` is a note, not
 * a refusal.
 */
async function coverageMessage(
  root: string,
  contract: Contract,
): Promise<string | null> {
  try {
    return closedRuleCoverageWarning(
      await loadSlice(root),
      await loadObserved(root),
      contract.rules,
    );
  } catch {
    return "note: no readable .hexagen/slice.json and .hexagen/observed.json, so the excepts were not checked against the repo's packages";
  }
}

export interface ContractCheckOptions extends SliceRootOptions {
  baseline?: boolean;
  yes?: boolean;
  strict?: boolean;
}

export function runContractCheck(
  options: ContractCheckOptions,
): Promise<CommandResult> {
  return locked(
    options.root,
    options.baseline === true && options.yes === true,
    () => check(options),
  );
}

async function check(options: ContractCheckOptions): Promise<CommandResult> {
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
      const now = new Date();
      const known = failing.map((v) => {
        const prior = base.knownViolations.find(
          (k) =>
            k.rule === v.rule &&
            k.file === v.file &&
            k.specifier === v.specifier,
        );
        // A past expiry is dropped on re-baseline, so the entry hides again.
        const { expires, ...kept } = prior ?? {};
        return {
          ...kept,
          ...(expires !== undefined && !isSuppressionExpired(expires, now)
            ? { expires }
            : {}),
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

    const now = new Date();
    const lines: string[] = [];
    let failing = 0;
    let known = 0;
    for (const v of violations) {
      if (isKnown(contract, v, now)) {
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

// Commander exits 1 for its own usage errors (a missing required option, an
// unknown flag), which reads as a failed gate rather than a refused command.
// Every other refusal in these commands is exit 2, so a missing `--kind` must be
// too. Scoped to this command tree — set before the subcommands are created, so
// `copyInheritedSettings` hands the callback to each of them — and every other
// command keeps its own exit codes. `--help` and `--version` exit 0 and are left
// alone.
contractCommander.exitOverride((err) => {
  if (err.exitCode === 0) return;
  process.exit(2);
});

contractCommander
  .command("propose")
  .description(
    "List candidate rules for the slice from the observed edges (writes nothing)",
  )
  .option(
    "--closed",
    "Emit one candidate closed rule instead, whose --except list names every crossing observed.json already makes",
  )
  .option("--strict", STRICT_DESC)
  .option(ROOT_FLAG, ROOT_DESC)
  .action(
    async (opts: { root?: string; strict?: boolean; closed?: boolean }) => {
      emit(
        await runContractPropose({
          root: opts.root ?? process.cwd(),
          strict: opts.strict,
          closed: opts.closed,
        }),
      );
    },
  );

const addRuleCommander = contractCommander
  .command("add-rule")
  .description("Add a rule to .hexagen/contract.json (requires --yes)")
  .requiredOption("--kind <kind>", "forbid, allow-only or closed")
  .option("--from <prefix>", "Source path prefix (forbid and allow-only)")
  .option("--to <prefix>", "Target path prefix (forbid and allow-only)")
  .option("--severity <severity>", "error (default) or warn")
  .option("--id <id>", "Rule id (not a built-in id); random by default")
  .option(ROOT_FLAG, ROOT_DESC)
  .option("--yes", "Confirm the writes listed by the `will write:` lines");
// A bare occurrence of an optional-value option is otherwise collected as
// `true`, which replaced the prefixes an earlier `--except` had gathered and
// dropped the user's crossings. `preset([])` appends an empty group instead, so
// nothing collected is lost; the action flattens the groups.
addRuleCommander.addOption(
  addRuleCommander
    .createOption(
      "--except [prefix...]",
      "Accepted crossing prefix; repeatable, and may be given no prefixes at all (closed)",
    )
    .preset([]),
);

addRuleCommander.action(
  async (opts: {
    kind: string;
    from?: string;
    to?: string;
    /** One group per occurrence, as `preset([])` collects them. */
    except?: string[][];
    severity?: string;
    id?: string;
    root?: string;
    yes?: boolean;
  }) => {
    emit(
      await runContractAddRule({
        root: opts.root ?? process.cwd(),
        kind: opts.kind as AddRuleOptions["kind"],
        from: opts.from,
        to: opts.to,
        except: Array.isArray(opts.except) ? opts.except.flat() : undefined,
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
