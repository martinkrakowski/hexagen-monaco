"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
} from "@hexagen/ui";
import { X, Zap, Cpu, KeyRound, ChevronRight } from "lucide-react";
import { usePreferredLLM } from "./store/usePreferredLLM";
import { useLocalLLM } from "@/lib/local-llm-context";
import { useFreeTierQuota, type FreeTierQuota } from "./hooks/useFreeTierQuota";

/**
 * Pure presentation for the Free Tier modal — all data and actions arrive as
 * props, so it renders with zero hooks and is unit-testable directly (the
 * hook-bound container below isn't, since neither next/navigation nor the local
 * hook modules can be mocked under the test runner — see the test file).
 */
export interface FreeTierModelModalViewProps {
  open: boolean;
  /** The model serving generation (e.g. mercury-2); generic fallback when null. */
  modelName?: string | null;
  /** Whether the user has chosen a local (WebLLM) model. */
  hasLocalModel: boolean;
  /** Whether that local model is loaded and ready. */
  webLLMReady: boolean;
  /** Today's free-tier usage (from /api/free-tier/quota); null while loading. */
  quota?: FreeTierQuota | null;
  onClose: () => void;
  onUseWebLLM: () => void;
  onUseFreeTier: () => void;
  onOpenModels: () => void;
}

export function FreeTierModelModalView({
  open,
  modelName,
  hasLocalModel,
  webLLMReady,
  quota,
  onClose,
  onUseWebLLM,
  onUseFreeTier,
  onOpenModels,
}: FreeTierModelModalViewProps) {
  const modelLabel = modelName ?? "our hosted model";

  return (
    <Dialog open={open} onClose={onClose}>
      {open && (
        <DialogContent>
          <DialogHeader>
            <div className="flex items-start gap-4">
              <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-primary/10">
                <Zap className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle>Free Tier</DialogTitle>
                <DialogDescription className="mt-1">
                  Project generation runs on{" "}
                  <span className="font-medium text-foreground">
                    {modelLabel}
                  </span>{" "}
                  — fast and free, with no API key required.
                </DialogDescription>
              </div>
              <button
                onClick={onClose}
                className="-mr-1 -mt-1 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </DialogHeader>

          <div className="space-y-4">
            {/* Free-tier daily limits + live remaining (PR-6). */}
            <div className="rounded-md bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {quota && quota.generation.remaining === 0 ? (
                <span>
                  You&apos;ve used today&apos;s{" "}
                  <span className="font-medium text-foreground">
                    {quota.generation.limit} free generations
                  </span>
                  . Switch to a local model or your own key below to keep
                  building — the free tier resets at midnight UTC.
                </span>
              ) : (
                <span>
                  Free tier is shared, so it&apos;s capped per day — no API key,
                  no sign-in.
                  {quota && (
                    <span className="text-foreground">
                      {" "}
                      <span className="font-medium">
                        {quota.generation.remaining} of {quota.generation.limit}
                      </span>{" "}
                      generations and{" "}
                      <span className="font-medium">
                        {quota.chat.remaining} of {quota.chat.limit}
                      </span>{" "}
                      chat messages left today.
                    </span>
                  )}
                </span>
              )}
            </div>

            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Other ways to run it
              </p>

              {/* WebLLM (local) */}
              <button
                onClick={onUseWebLLM}
                className="group flex w-full items-start gap-3 rounded-md border border-border bg-card p-4 text-left transition-colors hover:bg-accent/40"
              >
                <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-success/10">
                  <Cpu className="h-[18px] w-[18px] text-success" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      Use WebLLM (Local)
                    </span>
                    <span className="inline-flex items-center rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                      Private · Offline
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Runs entirely in your browser via WebAssembly — private,
                    offline, and never rate-limited. Needs a one-time model
                    download; best for small-to-medium projects.
                    {hasLocalModel
                      ? webLLMReady
                        ? " Your model is ready now."
                        : " Your model is selected — activate to load it."
                      : " Pick and download a model to start."}
                  </p>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
              </button>

              {/* BYOK */}
              <button
                onClick={onOpenModels}
                className="group flex w-full items-start gap-3 rounded-md border border-border bg-card p-4 text-left transition-colors hover:bg-accent/40"
              >
                <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-info/10">
                  <KeyRound className="h-[18px] w-[18px] text-info" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      Bring Your Own Keys
                    </span>
                    <span className="inline-flex items-center rounded-full bg-info/10 px-2 py-0.5 text-xs font-medium text-info">
                      Frontier models
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Add your own OpenAI, Anthropic, or Google key to use
                    frontier models (GPT-4o, Claude, Gemini) with no shared
                    limits.
                  </p>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
              </button>
            </div>

            <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
              Switching to a local model applies immediately — change it anytime
              from the model badge.
            </p>
          </div>

          <DialogFooter>
            <Button onClick={onUseWebLLM}>
              {hasLocalModel
                ? webLLMReady
                  ? "Switch to WebLLM"
                  : "Activate local model"
                : "Choose a local model"}
            </Button>
            {hasLocalModel ? (
              <Button variant="outline" onClick={onUseFreeTier}>
                Use Free Tier instead
              </Button>
            ) : (
              <Button variant="outline" onClick={onClose}>
                Continue on Free Tier
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

interface FreeTierModelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The actual model serving generation (e.g. mercury-2), shown in the lead
   * copy. Falls back to a generic phrase when unknown. */
  modelName?: string | null;
  /** App router, injected by the caller (FreeTierContext) rather than read via
   * useRouter() — next/navigation's exports are non-configurable, so this keeps
   * the navigation path injectable (the ADR-0038 router-injection pattern). */
  router: { push: (href: string) => void };
}

/**
 * Hook-bound container. Reads the local-LLM hooks here (mounted on demand by
 * FreeTierContext, never on every shell render) and delegates rendering to the
 * pure view above.
 */
export function FreeTierModelModal({
  open,
  onOpenChange,
  modelName,
  router,
}: FreeTierModelModalProps) {
  const { preferredLocalModel, clearPreferredLocalModel } = usePreferredLLM();
  const llmContext = useLocalLLM();
  const webLLMReady = llmContext.loadedModel !== null;
  const quota = useFreeTierQuota();

  const onOpenModels = () => {
    // Current path for the return URL — read at click time (not via
    // usePathname, which would re-add a next/navigation hook to this seam).
    const returnUrl =
      typeof window !== "undefined" ? window.location.pathname : "/";
    router.push(
      `/projects/new/ai/models?returnUrl=${encodeURIComponent(returnUrl)}`,
    );
    onOpenChange(false);
  };

  // Use WebLLM: activate the already-chosen local model. switchModel cold-loads
  // when nothing is active yet — it disposes any current adapter, resets engine
  // state, then awaits initializeModel(modelId) — so this also covers the
  // "selected but not loaded" state whose CTA reads "Activate local model".
  // (Gating the call on webLLMReady, as before, skipped activation in exactly
  // that state, so the button just closed the modal.) Fire-and-forget: every
  // surface that opens this modal sits under the /projects/new layout, which
  // renders a global ModelProgressCard for download/VRAM progress; and
  // initializeModel captures its own errors into engine state (it never
  // rejects), so the floating promise is safe.
  const onUseWebLLM = () => {
    if (preferredLocalModel) {
      void llmContext.switchModel(preferredLocalModel);
      onOpenChange(false);
      return;
    }
    onOpenModels();
  };

  const onUseFreeTier = () => {
    clearPreferredLocalModel();
    onOpenChange(false);
  };

  return (
    <FreeTierModelModalView
      open={open}
      modelName={modelName}
      hasLocalModel={preferredLocalModel !== null}
      webLLMReady={webLLMReady}
      quota={quota}
      onClose={() => onOpenChange(false)}
      onUseWebLLM={onUseWebLLM}
      onUseFreeTier={onUseFreeTier}
      onOpenModels={onOpenModels}
    />
  );
}
