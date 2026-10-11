/* eslint-disable no-console */
import {
  FileSystemTemplateRegistry,
  FileSystemTemplateConfigStore,
  FileSystemProjectRemovalFiles,
  RemoveTemplateUseCase,
  RemovalDeleteError,
} from "@hexagen/template-engine";
import type { RemoveTemplateResult } from "@hexagen/template-engine";
import type { RemovalRefusal } from "@hexagen/template-engine";
import {
  confirm,
  getProjectRoot,
  resolveTemplatesDir,
} from "../shared/index.js";
import { detectWorkspaces } from "../shared/detect-workspaces.js";

/**
 * `hexagen remove <template>` — the command shell and the testable core
 * (proposal 2026-10-10, "The decided contract"). The core never calls
 * `process.exit`, never reads `process.cwd()`, and prints everything
 * through injected `log` / `error`; the use case owns every decision.
 * Exit codes are 0 and 1 only — there is NO exit code 2.
 */
export interface RemoveCommandOptions {
  /** Print the plan and change nothing. */
  dryRun?: boolean;
  /** Remove the registry entry only; delete no file. */
  keepFiles?: boolean;
  /** Skip the prompt and override the dependents / changed-file refusals. */
  force?: boolean;
}

export interface RemoveCommandDeps {
  projectRoot: string;
  useCase: Pick<RemoveTemplateUseCase, "execute">;
  log: (line: string) => void;
  error: (line: string) => void;
  isInteractive: boolean;
  confirm: (message: string) => Promise<boolean>;
  /** Workspace package folders other than the registry root, when known. */
  otherPackages?: string[];
}

function refusalLines(
  templateId: string,
  refusals: readonly RemovalRefusal[],
): string[] {
  const lines: string[] = [];
  for (const refusal of refusals) {
    if (refusal.kind === "dependents") {
      lines.push(
        `Refused: these installed templates require '${templateId}': ${refusal.templates.join(", ")}. Remove them first, or pass --force.`,
      );
    } else if (refusal.kind === "unknown-dependents") {
      lines.push(
        `Refused: these installed templates could not be read, so they may require '${templateId}': ${refusal.templates.join(", ")}. Pass --force to remove it anyway.`,
      );
    } else {
      // unsafe-paths: --force does NOT override this refusal, so it is
      // never suggested here — only --keep-files, which touches no file.
      lines.push(
        `Refused: the registry records paths outside the project (or protected): ${refusal.paths.join(", ")}. Nothing was touched. Use --keep-files to drop the registry entry without touching any file.`,
      );
    }
  }
  return lines;
}

/**
 * Prints a non-removal answer (no-registry, not-installed, refused) and
 * returns its exit code, or null when the result is the dry-run plan and
 * the caller must continue.
 */
function reportNonRemoval(
  result: RemoveTemplateResult,
  deps: RemoveCommandDeps,
): 0 | 1 | null {
  if (result.kind === "no-registry") {
    deps.error(
      `No template registry (.hexagen-template-config.json) in ${deps.projectRoot}: nothing is installed here.`,
    );
    return 1;
  }
  if (result.kind === "not-installed") {
    deps.log(
      `Template '${result.templateId}' is not installed. Nothing to remove.`,
    );
    return 0;
  }
  if (result.kind === "refused") {
    for (const line of refusalLines(result.templateId, result.refusals)) {
      deps.error(line);
    }
    return 1;
  }
  return null;
}

function removeFailed(err: unknown, deps: RemoveCommandDeps): 1 {
  const message = err instanceof Error ? err.message : String(err);
  deps.error(`Remove failed: ${message}`);
  if (err instanceof RemovalDeleteError) {
    deps.error(
      "Some files may already be deleted; the registry entry is still there. Run the same command again to finish.",
    );
  }
  return 1;
}

function printMonorepoNote(deps: RemoveCommandDeps): void {
  const others = deps.otherPackages ?? [];
  if (others.length > 0) {
    deps.log(
      `Note: this acts on the registry at ${deps.projectRoot} only; other packages (${others.length}) are not looked at.`,
    );
  }
}

type RemovalPlanAnswer = Extract<RemoveTemplateResult, { kind: "dry-run" }>;
type RemovalOutcomeAnswer = Extract<RemoveTemplateResult, { kind: "removed" }>;

/** A section header plus each path indented on its own line; nothing when empty. */
function section(header: string, paths: readonly string[]): string[] {
  if (paths.length === 0) return [];
  return [header, ...paths.map((p) => `  ${p}`)];
}

function keptSections(
  answer: RemovalPlanAnswer | RemovalOutcomeAnswer,
): string[] {
  return [
    ...section("Kept: changed since install:", answer.keptChanged),
    ...section(
      "Kept: also recorded by another installed template:",
      answer.keptShared,
    ),
    ...section("Kept: not a plain file, or unreadable:", answer.keptOther),
    ...section("Kept: --keep-files:", answer.keptByFlag),
  ];
}

/** The --dry-run plan, as lines. Only non-empty lists get a header. */
export function formatRemovalPlan(plan: RemovalPlanAnswer): string[] {
  const unchanged = plan.deleteFiles.filter(
    (p) => !plan.deleteChanged.includes(p),
  );
  return [
    ...section("Will delete (unchanged since install):", unchanged),
    ...section(
      "Will delete although CHANGED since install (--force):",
      plan.deleteChanged,
    ),
    ...keptSections(plan),
    ...section(
      "Already absent (their records leave the registry):",
      plan.alreadyAbsent,
    ),
    ...section(
      "Conflict copies beside these files (listed, NOT deleted):",
      plan.conflictCopies,
    ),
    ...section(
      `WARNING: these installed templates require '${plan.templateId}' and will be broken (--force):`,
      plan.brokenDependents,
    ),
    ...section(
      `WARNING: these installed templates could not be read and may require '${plan.templateId}' (--force):`,
      plan.unknownDependents,
    ),
    ...(plan.malformedRecords > 0
      ? [
          `Note: ${plan.malformedRecords} malformed file record(s) in the registry entry are dropped with it.`,
        ]
      : []),
    `The registry entry of '${plan.templateId}' will be removed.`,
  ];
}

/** The removal outcome, as lines. Only non-empty lists get a header. */
export function formatRemovalOutcome(result: RemovalOutcomeAnswer): string[] {
  return [
    `Removed template '${result.templateId}'.`,
    ...section(`Deleted ${result.deleted.length} file(s):`, result.deleted),
    ...section(
      `Removed ${result.prunedDirs.length} empty folder(s):`,
      result.prunedDirs,
    ),
    ...keptSections(result),
    ...section(
      "Already absent (their records leave the registry):",
      result.alreadyAbsent,
    ),
    ...section(
      "Kept at the last moment (changed while the command ran):",
      result.skippedAtDelete.map((s) => `${s.path} (${s.reason})`),
    ),
    ...section(
      "Conflict copies beside these files (listed, NOT deleted):",
      result.conflictCopies,
    ),
    ...section(
      `WARNING: these installed templates require '${result.templateId}' and will be broken (--force):`,
      result.brokenDependents,
    ),
    ...section(
      `WARNING: these installed templates could not be read and may require '${result.templateId}' (--force):`,
      result.unknownDependents,
    ),
    ...section(
      `Templates whose derived answers came from '${result.templateId}' (re-run their add to refresh):`,
      result.derivedAnswerWarnings,
    ),
    ...(result.checklist.length > 0
      ? [
          "Manual steps to undo (package.json is never edited):",
          ...result.checklist.map((c) => `  ${c}`),
        ]
      : []),
  ];
}

export async function runRemoveTemplate(
  templateId: string,
  options: RemoveCommandOptions,
  deps: RemoveCommandDeps,
): Promise<0 | 1> {
  const force = options.force ?? false;
  const keepFiles = options.keepFiles ?? false;
  const { projectRoot } = deps;

  // Step 1. PLAN: the first call is ALWAYS a dry run, whatever the flags.
  let plan: RemoveTemplateResult;
  try {
    plan = await deps.useCase.execute({
      projectRoot,
      templateId,
      force,
      keepFiles,
      dryRun: true,
    });
  } catch (err) {
    return removeFailed(err, deps);
  }

  // Step 2. The non-removal answers; the plan falls through.
  const early = reportNonRemoval(plan, deps);
  if (early !== null) {
    return early;
  }
  if (plan.kind !== "dry-run") {
    return removeFailed(new Error("internal error: unexpected result"), deps);
  }

  // The root is found by walking up from the working directory: say which
  // project this acts on before the plan, every time.
  deps.log(`Project root: ${projectRoot}`);
  printMonorepoNote(deps);
  for (const line of formatRemovalPlan(plan)) {
    deps.log(line);
  }

  // Step 3. --dry-run stops here: one call, nothing changed.
  if (options.dryRun) {
    deps.log("Dry run: nothing was changed.");
    return 0;
  }

  // Step 4. Confirmation, only without --force.
  if (!force) {
    if (!deps.isInteractive) {
      deps.error(
        "Refusing to remove without confirmation: stdin is not a terminal. Pass --force to skip the prompt, or --dry-run to see the plan.",
      );
      return 1;
    }
    const yes = await deps.confirm(`Remove template '${templateId}'?`);
    if (!yes) {
      // The user declined: nothing failed, nothing changed.
      deps.log("Nothing was changed.");
      return 0;
    }
  }

  // Step 5. REMOVE.
  let result: RemoveTemplateResult;
  try {
    result = await deps.useCase.execute({
      projectRoot,
      templateId,
      force,
      keepFiles,
      dryRun: false,
    });
  } catch (err) {
    return removeFailed(err, deps);
  }

  if (result.kind === "removed") {
    for (const line of formatRemovalOutcome(result)) {
      deps.log(line);
    }
    return 0;
  }
  if (result.kind === "dry-run") {
    deps.error("internal error: unexpected dry-run result");
    return 1;
  }
  const late = reportNonRemoval(result, deps);
  return (
    late ?? removeFailed(new Error("internal error: unexpected result"), deps)
  );
}

export async function removeTemplateCommand(
  templateId: string,
  options: RemoveCommandOptions = {},
): Promise<void> {
  const projectRoot = getProjectRoot();
  const templatesDir = resolveTemplatesDir();
  const registry = new FileSystemTemplateRegistry(templatesDir);
  const configStore = new FileSystemTemplateConfigStore();
  const files = new FileSystemProjectRemovalFiles();
  const useCase = new RemoveTemplateUseCase(registry, configStore, files);

  let otherPackages: string[] | undefined;
  try {
    const detection = await detectWorkspaces(projectRoot);
    otherPackages = detection.packages
      .map((p) => p.root)
      .filter((root) => root !== ".");
  } catch {
    otherPackages = undefined;
  }

  const code = await runRemoveTemplate(templateId, options, {
    projectRoot,
    useCase,
    log: console.log,
    error: console.error,
    isInteractive: process.stdin.isTTY === true,
    confirm: (message) => confirm(message, { default: false }),
    otherPackages,
  });
  if (code === 1) {
    // Not process.exit: a piped stderr must be flushed before the process ends.
    process.exitCode = 1;
  }
}
