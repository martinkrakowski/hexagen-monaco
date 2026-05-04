/**
 * Project Lifecycle Use Case
 *
 * This is the composition root use case for project lifecycle management.
 * It orchestrates cross-package operations but stays in apps/ because it
 * IS the composition root - it wires together multiple domain hooks and
 * infrastructure adapters.
 *
 * Package dependencies:
 * - @hexagen/project-configuration: ProjectConfig type
 * - @hexagen/wizard-orchestration: buildWizardData
 * - @hexagen/monaco-orchestration: PROJECT_DISCARDED_EVENT, getEventBus, getChatPersistence
 */

import type { ProjectConfig } from "@hexagen/project-configuration";
import { buildWizardData } from "@hexagen/wizard-orchestration";
import { getEventBus, getChatPersistence } from "@/lib/wire";
import { PROJECT_DISCARDED_EVENT } from "@hexagen/monaco-orchestration";

export interface DiscardProjectResult {
  success: boolean;
}

export async function loadProject(
  saved: unknown,
  clearDraft: () => Promise<void>,
): Promise<void> {
  await clearDraft();
}

export function buildWizardDataFromConfig(config: ProjectConfig) {
  return buildWizardData(
    config.boundedContexts,
    config.externalContexts,
    config.peerMappings,
    config.governance,
  );
}

export interface UpdateProjectParams {
  projectId: string;
  formData: ProjectConfig;
  updateProject: (
    id: string,
    formData: ProjectConfig,
    wizardData: string,
  ) => void;
}

export function updateProject(params: UpdateProjectParams): void {
  const wizardData = buildWizardDataFromConfig(params.formData);
  params.updateProject(
    params.projectId,
    params.formData,
    JSON.stringify(wizardData),
  );
}

export interface DiscardProjectParams {
  projectId: string;
  pendingWelcomeManifest: string | null;
  onSuccess: (manifest: string) => Promise<void>;
}

export async function discardProject(
  params: DiscardProjectParams,
): Promise<DiscardProjectResult> {
  const eventBus = getEventBus();
  eventBus.publish({
    type: PROJECT_DISCARDED_EVENT,
    payload: {
      projectId: params.projectId,
      timestamp: new Date(),
      reason: "user_initiated" as const,
    },
    timestamp: Date.now(),
    source: "useProjectLifecycle",
  });

  const chatPersistence = getChatPersistence();
  try {
    await chatPersistence.purgeProjectData(params.projectId);
  } catch (err) {
    console.error("Failed to purge chat persistence data:", err);
  }

  if (params.pendingWelcomeManifest) {
    await params.onSuccess(params.pendingWelcomeManifest);
    return { success: true };
  }

  return { success: true };
}

export interface ResetToGenesisParams {
  onEnterGenesisMode: () => void;
  onClearSession: () => void;
  onClearActiveWorkspace: () => void;
  onResetForm: () => void;
  onCloseDialog: () => void;
  onSetStep: (step: number) => void;
}

export function resetToGenesis(params: ResetToGenesisParams): void {
  params.onResetForm();
  params.onSetStep(0);
  params.onEnterGenesisMode();
  params.onCloseDialog();
  params.onClearSession();
  params.onClearActiveWorkspace();
}
