import type { LLMEngineState } from "@hexagen/local-llm";

/**
 * What the local-engine half of the governance panel should be showing
 * (REA-002).
 *
 * This replaces six independent booleans — `showBootSpinner`,
 * `showUnavailable`, `showWakingUp`, `showProgress`, `showError`,
 * `showRequiresModel` — that were computed in the panel, threaded through
 * `ModeWrapper`, and re-decoded by three child views. They were mutually
 * exclusive by construction and by nothing else: the prop type allowed all six
 * at once, every consumer had to re-derive the precedence, and the boot view
 * recovered `no_webgpu | unsupported_browser` with a cast that was correct only
 * because a boolean computed in another file happened to agree with it.
 *
 * As a union those states cannot overlap, the data each card needs travels on
 * the variant that needs it, and the cast is gone.
 */
export type LocalLifecycle =
  /** Engine not started yet (or awaiting opt-in): show a neutral spinner. */
  | { kind: "booting" }
  /** The browser cannot run a local model at all. */
  | { kind: "unsupported"; reason: "no_webgpu" | "unsupported_browser" }
  /** Auto-resuming a cached model on mount — a quieter card than a download. */
  | { kind: "waking-up" }
  /** A user-initiated download or VRAM load, with its progress. */
  | {
      kind: "loading";
      status: "downloading" | "loading_vram";
      progress: number;
    }
  /** The engine failed; `message` is whatever the engine reported. */
  | { kind: "failed"; message: string | null }
  /** No model chosen yet: the settings card shows its "pick one" warning. */
  | { kind: "requires-model" }
  /** Nothing to say about the local engine — the panel behaves normally. */
  | { kind: "usable" };

/**
 * Decide the lifecycle from engine state.
 *
 * `serverAssistantAvailable` short-circuits every card: when the deployment
 * ships a server-side assistant key, the browser engine is an optional
 * accelerator and its state is not the user's problem. Previously that
 * condition was repeated as `&& !hasServerLLMAccessKey()` on each of the six
 * booleans, so a seventh card added later would have had to remember it.
 *
 * The `default` arm is the compile-time half of the guard: `status` is narrowed
 * to `never` there, so a status added to `LLMEngineStatus` upstream fails
 * `apps/web`'s `tsc --noEmit` here rather than silently falling through to a
 * blank panel.
 */
export function selectLocalLifecycle(
  engineState: LLMEngineState,
  serverAssistantAvailable: boolean,
): LocalLifecycle {
  if (serverAssistantAvailable) return { kind: "usable" };

  const { status, autoLoading, progress, errorMessage } = engineState;

  switch (status) {
    case "unavailable":
    case "opt_in":
      return { kind: "booting" };
    case "no_webgpu":
    case "unsupported_browser":
      return { kind: "unsupported", reason: status };
    case "downloading":
      return { kind: "loading", status, progress };
    case "loading_vram":
      return autoLoading
        ? { kind: "waking-up" }
        : { kind: "loading", status, progress };
    case "error":
      return { kind: "failed", message: errorMessage };
    case "requires_model":
      return { kind: "requires-model" };
    case "ready":
      return { kind: "usable" };
    default: {
      const unhandled: never = status;
      throw new Error(
        `Unhandled LLM engine status: ${String(unhandled)}. Add a LocalLifecycle variant for it.`,
      );
    }
  }
}

/**
 * True when the lifecycle card replaces the whole panel.
 *
 * `requires-model` does not: the panel routes to model settings for it through
 * `panelView`, exactly as the old `showRequiresModel` boolean did — it was the
 * one `show*` flag deliberately absent from the panel's takeover condition.
 */
export function lifecycleOwnsThePanel(lifecycle: LocalLifecycle): boolean {
  return lifecycle.kind !== "usable" && lifecycle.kind !== "requires-model";
}
