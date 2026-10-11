/**
 * Wording of the "local models cannot run here" notice (#766). Shared by the
 * model page (ModelSelectionPage) and the generation page (GenerateWithAi) so
 * the two never drift.
 */
export const LOCAL_UNSUPPORTED_TITLE =
  "Local models cannot run in this browser";

export const LOCAL_UNSUPPORTED_BODY =
  "This browser does not support WebGPU, which local models need. Open this page in a browser that supports WebGPU, or go back.";

export const LOCAL_UNSUPPORTED_BODY_WITH_CLOUD =
  "This browser does not support WebGPU, which local models need. The cloud model shown below is active, so you can continue without a local model.";
