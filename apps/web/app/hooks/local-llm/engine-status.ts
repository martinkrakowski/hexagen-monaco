import type { LLMEngineStatus, LLMProgress } from "@hexagen/local-llm";

/**
 * Pure mapping: hardware+progress signals → engine status.
 *
 * Called once during mount after WebGPU detection resolves. Returns
 * the terminal unsupported states ("no_webgpu" / "unsupported_browser")
 * when the environment can't run any model, "opt_in" when it can but
 * no download has started, or the appropriate progress phase status.
 */
export function deriveStatus(
  progress: LLMProgress | null,
  webgpuSupported: boolean,
  browserSupported: boolean,
): LLMEngineStatus {
  if (!webgpuSupported) return "no_webgpu";
  if (!browserSupported) return "unsupported_browser";
  if (!progress) return "opt_in";
  return progressToStatus(progress.phase);
}

/**
 * Pure mapping: WebLLM progress phase → engine status.
 *
 * "loading-model" covers both network fetches (cache miss) and
 * cache-to-GPU reads (cache hit); the network/cache distinction is
 * determined separately via isNetworkFetchProgress because the phase
 * alone is ambiguous.
 */
export function progressToStatus(phase: LLMProgress["phase"]): LLMEngineStatus {
  switch (phase) {
    case "ready":
      return "ready";
    case "error":
      return "error";
    case "compiling-shader":
    case "initializing-engine":
      return "loading_vram";
    case "loading-model":
    default:
      return "downloading";
  }
}

/**
 * Inspects WebLLM's progress text to distinguish a real network
 * download ("Fetching param cache[N/M]...") from a warm cache load
 * ("Loading model from cache[N/M]..."). Used to clear the autoLoading
 * flag only on true network activity — we don't want to clear it
 * when the user is just waiting for an already-cached model to warm
 * into VRAM.
 */
export function isNetworkFetchProgress(progressText: string): boolean {
  const text = progressText.toLowerCase();
  return (
    text.includes("fetching") && !text.includes("loading model from cache")
  );
}
