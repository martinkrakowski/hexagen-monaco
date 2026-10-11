import type { RecordedFileState, RemovalRefusal } from "../../domain/index.js";
import {
  configState,
  emptyConfig,
  planTemplateRemoval,
  recordedPaths,
} from "../../domain/index.js";
import type { TemplateConfig } from "../../domain/index.js";
import type { TemplateRegistryPort } from "../ports/template-registry.port.js";
import type { TemplateConfigStorePort } from "../ports/template-config-store.port.js";
import type { ProjectRemovalFilesPort } from "../ports/project-removal-files.port.js";
import type {
  RemovalDeleteRequest,
  RemovalSkipReason,
} from "../ports/project-removal-files.port.js";

/**
 * `hexagen remove <template>` (proposal 2026-10-10, "The decided
 * contract"): joins the pure removal plan (planTemplateRemoval) to the
 * filesystem adapter (ProjectRemovalFilesPort) and the config store. It
 * deletes files in a user's project, so it deletes less and refuses more:
 * every refusal from the plan is returned untouched, the registry entry is
 * saved only after the deletions and the pruning succeeded, and the last
 * moment skips of the adapter are folded back into the kept lists. It
 * prints nothing and never exits the process — the command does both.
 */
export interface RemoveTemplateInput {
  projectRoot: string;
  templateId: string;
  /** Skip the refusals (dependents, changed files) and delete anyway. */
  force?: boolean;
  /** Remove the registry entry only; delete no file. */
  keepFiles?: boolean;
  /** Report the plan and touch nothing. */
  dryRun?: boolean;
}

/** The plan's lists, verbatim from planTemplateRemoval's "remove" branch. */
interface RemovalPlanLists {
  templateId: string;
  /** Normalised paths to delete, sorted. Empty when keepFiles. */
  deleteFiles: string[];
  /** The subset of deleteFiles whose hash differs from the record (only ever non-empty with force). */
  deleteChanged: string[];
  keptChanged: string[];
  keptShared: string[];
  keptOther: string[];
  keptByFlag: string[];
  alreadyAbsent: string[];
  /** Dependents that are now broken (only with force). */
  brokenDependents: string[];
  unknownDependents: string[];
  /** Entries of the record that were not `{ path: string, contentHash: string }`. */
  malformedRecords: number;
}

export type RemoveTemplateResult =
  | {
      /** No registry file in the project. The command exits 1 unless --force. */
      kind: "no-registry";
      templateId: string;
    }
  | { kind: "not-installed"; templateId: string }
  | { kind: "refused"; templateId: string; refusals: RemovalRefusal[] }
  | (RemovalPlanLists & {
      kind: "dry-run";
      /** The `.hexagen-update` conflict copies beside the recorded paths. */
      conflictCopies: string[];
    })
  | (RemovalPlanLists & {
      kind: "removed";
      deleted: string[];
      /** Files the adapter skipped at the last moment, with why. */
      skippedAtDelete: { path: string; reason: RemovalSkipReason }[];
      prunedDirs: string[];
      conflictCopies: string[];
      /** The removed template's own checklist, when its manifest could be loaded. */
      checklist: string[];
      /** Installed templates whose `auto` questions derive from this one. */
      derivedAnswerWarnings: string[];
      registrySaved: boolean;
    });

export class RemoveTemplateUseCase {
  constructor(
    private readonly registry: TemplateRegistryPort,
    private readonly configStore: TemplateConfigStorePort,
    private readonly files: ProjectRemovalFilesPort,
  ) {}

  async execute(input: RemoveTemplateInput): Promise<RemoveTemplateResult> {
    const {
      projectRoot,
      templateId,
      force = false,
      keepFiles = false,
      dryRun = false,
    } = input;

    // Step 1. `absent` is a refusal unless --force, and even then there is
    // nothing to remove. A schema fault from loadState propagates: the
    // command exits 1 on it.
    const state = this.configStore.loadState
      ? await this.configStore.loadState(projectRoot)
      : configState(await this.configStore.load(projectRoot));
    if (state.state === "absent") {
      return force
        ? { kind: "not-installed", templateId }
        : { kind: "no-registry", templateId };
    }
    const config: TemplateConfig =
      state.state === "populated" ? state.config : emptyConfig();

    // Step 2. `requires` of every loadable manifest, by id, for the
    // dependents check; the removed template's own manifest gives the
    // checklist reminder, missing is fine.
    const manifests = await this.registry.loadAll();
    const requiresById = new Map<string, readonly string[]>(
      manifests.map((m) => [m.id, m.requires]),
    );
    const checklist =
      manifests.find((m) => m.id === templateId)?.checklist ?? [];

    // Step 3. The recorded paths, the current state of each, and the plan.
    const { safe } = recordedPaths(config, templateId);
    const recordedPathsList = safe.map((p) => p.path);
    const fileStates: ReadonlyMap<string, RecordedFileState> =
      await this.files.inspect(projectRoot, recordedPathsList);
    const plan = planTemplateRemoval({
      config,
      templateId,
      requiresById,
      fileStates,
      force,
      keepFiles,
    });

    // Step 4. Nothing is touched on the two non-remove plans.
    if (plan.kind === "not-installed") {
      return { kind: "not-installed", templateId };
    }
    if (plan.kind === "refused") {
      return { kind: "refused", templateId, refusals: plan.refusals };
    }

    const conflictCopies = (
      await this.files.existingConflictCopies(projectRoot, recordedPathsList)
    ).sort();

    // Step 5. The plan and the conflict copies, nothing else, nothing touched.
    if (dryRun) {
      return {
        kind: "dry-run",
        templateId: plan.templateId,
        deleteFiles: plan.deleteFiles,
        deleteChanged: plan.deleteChanged,
        keptChanged: plan.keptChanged,
        keptShared: plan.keptShared,
        keptOther: plan.keptOther,
        keptByFlag: plan.keptByFlag,
        alreadyAbsent: plan.alreadyAbsent,
        brokenDependents: plan.brokenDependents,
        unknownDependents: plan.unknownDependents,
        malformedRecords: plan.malformedRecords,
        conflictCopies,
      };
    }

    // Step 6, in this order: delete (expected hashes from the record; null
    // only for the plan's deleteChanged), prune, remove the entry, save
    // LAST — a failure before the save leaves the entry, so a re-run
    // finishes the job and reports the already-gone files as absent.
    const hashesByPath = new Map(
      safe.map((p) => [p.path, p.contentHashes] as const),
    );
    const changed = new Set(plan.deleteChanged);
    const requests: RemovalDeleteRequest[] = plan.deleteFiles.map((p) => ({
      path: p,
      expectedHashes: changed.has(p) ? null : (hashesByPath.get(p) ?? []),
    }));
    const outcome = await this.files.deleteFiles(projectRoot, requests);
    const prunedDirs = await this.files.pruneEmptyDirs(
      projectRoot,
      outcome.deleted,
    );

    // The adapter re-checked each file immediately before unlinking: what
    // it skipped at the last moment joins the plan's kept lists, and the
    // removal still counts as worked.
    const keptChanged = [...plan.keptChanged];
    const keptOther = [...plan.keptOther];
    const alreadyAbsent = [...plan.alreadyAbsent];
    for (const skip of outcome.skipped) {
      if (skip.reason === "absent") {
        alreadyAbsent.push(skip.path);
      } else if (skip.reason === "changed") {
        keptChanged.push(skip.path);
      } else {
        keptOther.push(skip.path);
      }
    }
    keptChanged.sort();
    keptOther.sort();
    alreadyAbsent.sort();

    // Step 7. The derived-answer warnings are read before the entry goes:
    // they name the templates that stay installed and derive from this one.
    const derivedAnswerWarnings = manifests
      .filter(
        (m) =>
          m.id !== templateId &&
          Object.hasOwn(config.templates, m.id) &&
          m.questions.some(
            (q) =>
              q.type === "auto" && q.derivedFrom.startsWith(`${templateId}.`),
          ),
      )
      .map((m) => m.id)
      .sort();

    delete config.templates[templateId];
    await this.configStore.save(projectRoot, config);

    return {
      kind: "removed",
      templateId: plan.templateId,
      deleteFiles: plan.deleteFiles,
      deleteChanged: plan.deleteChanged,
      keptChanged,
      keptShared: plan.keptShared,
      keptOther,
      keptByFlag: plan.keptByFlag,
      alreadyAbsent,
      brokenDependents: plan.brokenDependents,
      unknownDependents: plan.unknownDependents,
      malformedRecords: plan.malformedRecords,
      deleted: outcome.deleted,
      skippedAtDelete: outcome.skipped,
      prunedDirs,
      conflictCopies,
      checklist,
      derivedAnswerWarnings,
      registrySaved: true,
    };
  }
}
