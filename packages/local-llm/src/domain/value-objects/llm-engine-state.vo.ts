export type LLMEngineStatus =
  | "unavailable"
  | "unsupported_browser"
  | "no_webgpu"
  | "opt_in"
  | "downloading"
  | "loading_vram"
  | "ready"
  | "error";

export interface LLMEngineState {
  status: LLMEngineStatus;
  progress: number;
  loadedModelId: string | null;
  errorMessage: string | null;
}

export const createLLMEngineState = (
  status: LLMEngineStatus = "unavailable",
  progress = 0,
  loadedModelId: string | null = null,
  errorMessage: string | null = null,
): LLMEngineState => ({
  status,
  progress,
  loadedModelId,
  errorMessage,
});

export const LLM_ENGINE_INITIAL_STATE: LLMEngineState = {
  status: "unavailable",
  progress: 0,
  loadedModelId: null,
  errorMessage: null,
};
