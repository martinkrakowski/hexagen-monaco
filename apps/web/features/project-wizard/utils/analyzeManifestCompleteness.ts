import { ProjectConfig } from "@hexagen/project-configuration";
import { emptyFormValues } from "../config";

export interface ManifestCompleteness {
  governance: boolean;
  boundedContexts: boolean;
  peerMappings: boolean;
  portConfiguration: boolean;
  isComplete: boolean;
  firstIncompleteStepIndex: number;
}

export function analyzeManifestCompleteness(
  manifest: ProjectConfig | Partial<ProjectConfig>,
): ManifestCompleteness {
  // Let's use a simpler check:
  const isPopulated = (arr: unknown[] | undefined) =>
    Array.isArray(arr) && arr.length > 0;

  const gov = !!manifest.governance && !!manifest.governance.workspaceName;

  // Bounded contexts are populated if there is more than the default 1 empty context, or if the 1 context has been edited.
  let contextsComplete = false;
  if (manifest.boundedContexts && manifest.boundedContexts.length > 0) {
    const firstCtx = manifest.boundedContexts[0];
    contextsComplete =
      manifest.boundedContexts.length > 1 ||
      firstCtx.name !== emptyFormValues.boundedContexts[0].name ||
      firstCtx.infrastructureTarget !==
        emptyFormValues.boundedContexts[0].infrastructureTarget;
  }

  const portsComplete =
    !!manifest.boundedContexts &&
    manifest.boundedContexts.some(
      (ctx) =>
        isPopulated(ctx.portConfiguration?.inboundPorts) ||
        isPopulated(ctx.portConfiguration?.outboundPorts),
    );

  // Mappings are complete if there are mappings, or if they are not needed (only 1 context)
  const hasMappings = isPopulated(manifest.peerMappings);
  const needsMappings =
    manifest.boundedContexts && manifest.boundedContexts.length > 1;
  const peerMappingsComplete = hasMappings || !needsMappings;

  const completeness = {
    governance: gov,
    boundedContexts: contextsComplete,
    peerMappings: peerMappingsComplete,
    portConfiguration: portsComplete,
  };

  // Determine first incomplete step
  // 0: WorkspaceGovernanceStep (governance)
  // 1: BoundedContextStep (boundedContexts)
  // 2: PeerContextMappingStep (peerMappings)
  // 3: PortConfigurationStep (portConfiguration)
  // 4: SummaryStep

  let firstIncomplete = 0;
  if (!gov) firstIncomplete = 0;
  else if (!contextsComplete) firstIncomplete = 1;
  else if (!peerMappingsComplete) firstIncomplete = 2;
  else if (!portsComplete) firstIncomplete = 3;
  else firstIncomplete = 4; // All complete -> go to Summary

  return {
    ...completeness,
    isComplete: firstIncomplete === 4,
    firstIncompleteStepIndex: firstIncomplete,
  };
}
