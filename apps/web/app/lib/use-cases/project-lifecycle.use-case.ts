import { getEventBus, getChatPersistence } from "@/lib/wire.client";
import { PROJECT_DISCARDED_EVENT } from "@hexagen/monaco-orchestration";
import { logger } from "../../../lib/structured-logger";

export interface DiscardProjectResult {
  success: boolean;
}

export interface DiscardProjectParams {
  projectId: string;
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
    logger.error("Failed to purge chat persistence data:", { error: err });
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
