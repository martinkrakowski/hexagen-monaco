import { Cloud, CheckCircle2 } from "lucide-react";
import type { DomainModelId, ModelMetadata } from "@hexagen/local-llm/client";

import { ModelSettingsHeader } from "./model-settings-header";
import { WarningBanner } from "./warning-banner";
import {
  ModelTierSection,
  type ModelTierDescriptor,
} from "./model-tier-section";
import { CloudModelsSection } from "./cloud-models-section";
import { StorageFooter } from "./storage-footer";

/**
 * A tier heading plus the descriptors rendered under it. The panel does not
 * read the model catalog: the container projects it into this shape, so the
 * panel cannot discover a model that was not handed to it.
 */
export interface ModelTierGroup {
  readonly title: string;
  readonly descriptors: readonly ModelTierDescriptor[];
}

export interface ModelCacheEntry {
  readonly isCached: boolean;
  readonly isChecking: boolean;
}

/**
 * HEX-022 — the presentational counterpart of `@hexagen/ui`'s
 * `NoSemanticState`. `ModelSettingsPanel` renders an already-resolved
 * projection and raises intents; it must never be handed the means to
 * acquire that projection itself.
 *
 * Declaring these keys as `?: never` is what makes "presentation-only"
 * structural rather than aspirational:
 *
 *   - a caller writing `<ModelSettingsPanel hasModelInCache={probe} />` gets
 *     a type error at the call site, and
 *   - a future edit that re-adds `hasModelInCache: (id) => Promise<boolean>`
 *     to the props body intersects to `never`, so the property is unusable
 *     inside the component too.
 *
 * A lint rule can be waived per line and a test can be deleted; this cannot
 * be satisfied without deleting the component's own contract.
 */
type NoModelTransport<T extends object> = T & {
  /** Cache probe — the container owns cache I/O. */
  readonly hasModelInCache?: never;
  /** Engine switch — the container owns the model lifecycle. */
  readonly onSwitchModel?: never;
  /** Cache eviction — the container owns the model lifecycle. */
  readonly onDeleteModel?: never;
  /**
   * Conversation length — the container decides whether a switch needs
   * confirmation; the panel is told the answer via `pendingSwitchId`.
   */
  readonly messagesLength?: never;
};

export type ModelSettingsPanelProps = NoModelTransport<{
  // ── Already-resolved projection ───────────────────────────────────────────
  tiers: readonly ModelTierGroup[];
  currentModelId: DomainModelId | null;
  currentModelDisplayName: string | null;
  selectedModelId: DomainModelId | null;
  loadedModel: ModelMetadata | null;
  /** Resolved by the container from the detected hardware profile. */
  recommendedModelId: DomainModelId | null;
  /** Resolved by the container from the cache probe. */
  cacheStatusMap: ReadonlyMap<DomainModelId, ModelCacheEntry>;
  totalCached: number;
  totalCachedSize: number;

  // ── Transient interaction state, owned by the container ───────────────────
  confirmDeleteId: DomainModelId | null;
  pendingSwitchId: DomainModelId | null;
  isLoading: boolean;
  isSwitching: boolean;
  isDeleting: boolean;
  error: string | null;
  downloadingModelId: DomainModelId | null;
  downloadProgress: number;

  // ── Environment projection ────────────────────────────────────────────────
  hasServerApiKey: boolean;
  serverModelName?: string;
  generationModelName?: string;

  // ── Chrome ────────────────────────────────────────────────────────────────
  hideHeader?: boolean;
  requiresModelWarning?: boolean;

  // ── Intents: synchronous, fire-and-forget ─────────────────────────────────
  onSelectModel: (modelId: DomainModelId) => void;
  onRequestDelete: (modelId: DomainModelId) => void;
  onConfirmDelete: (modelId: DomainModelId) => void;
  onCancelDelete: () => void;
  onConfirmSwitch: () => void;
  onCancelSwitch: () => void;
  onBack?: () => void;
  onResetConfig?: () => void;
  onSwitchToCloud?: () => void;
}>;

/**
 * Presentational half of the model settings screen (HEX-022).
 *
 * No hooks, no effects, no ports: every value it renders arrives as a prop
 * and every user action leaves as a callback. `ModelSettingsView` is the
 * container that resolves the projection and binds the callbacks.
 */
export function ModelSettingsPanel({
  tiers,
  currentModelId,
  currentModelDisplayName,
  selectedModelId,
  loadedModel,
  recommendedModelId,
  cacheStatusMap,
  totalCached,
  totalCachedSize,
  confirmDeleteId,
  pendingSwitchId,
  isLoading,
  isSwitching,
  isDeleting,
  error,
  downloadingModelId,
  downloadProgress,
  hasServerApiKey,
  serverModelName,
  generationModelName,
  hideHeader,
  requiresModelWarning,
  onSelectModel,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onConfirmSwitch,
  onCancelSwitch,
  onBack,
  onResetConfig,
  onSwitchToCloud,
}: ModelSettingsPanelProps) {
  // Only render the two-column generation/Q&A split when the models actually
  // differ — when the staged chain head equals the chat model, a split layout
  // would name the same model twice.
  const showSplit =
    Boolean(generationModelName) && generationModelName !== serverModelName;

  return (
    <div className="h-full flex flex-col bg-card">
      {!hideHeader && <ModelSettingsHeader onBack={onBack} />}

      {requiresModelWarning && <WarningBanner />}

      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-5 mx-auto max-w-2xl w-full">
        {hasServerApiKey && (
          <div className="mb-6 p-5 rounded-lg border border-primary/30 bg-card relative overflow-hidden animate-fade-in-up">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent animate-shimmer-slow" />
            <div className="relative z-10 flex items-start gap-4">
              <div className="p-2 rounded-md bg-primary/15 text-primary">
                <Cloud className="h-6 w-6" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-foreground flex items-center gap-1.5 text-base">
                    Environment LLM Active
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-success/10 text-success">
                      Active
                    </span>
                  </h3>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {showSplit
                    ? "Server-side cloud LLMs are configured in the environment. Manifest generation and the assistant's question answering are served by separate models."
                    : "A server-side cloud LLM key is configured in the environment variables. The application will use this for high-performance manifest generation."}
                </p>
                <div className="pt-3 grid grid-cols-2 gap-4 text-xs">
                  {showSplit ? (
                    <>
                      <div>
                        <span className="text-muted-foreground block font-medium">
                          Manifest Generation
                        </span>
                        <span className="font-mono text-foreground font-semibold">
                          {generationModelName}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block font-medium">
                          Assistant Q&amp;A
                        </span>
                        <span className="font-mono text-foreground font-semibold">
                          {serverModelName ?? "Configured by environment"}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div>
                      <span className="text-muted-foreground block font-medium">
                        Model Name
                      </span>
                      <span className="font-mono text-foreground font-semibold">
                        {serverModelName ?? "Configured by environment"}
                      </span>
                    </div>
                  )}
                  {/* In split mode this is the 3rd cell of a 2-col grid —
                      span the full row so it doesn't sit as an orphan. */}
                  <div className={showSplit ? "col-span-2" : undefined}>
                    <span className="text-muted-foreground block font-medium">
                      Status
                    </span>
                    <span className="text-success font-medium flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Ready
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {tiers.map((tier) => (
          <ModelTierSection
            key={tier.title}
            title={tier.title}
            descriptors={tier.descriptors}
            currentModelId={currentModelId}
            selectedModelId={selectedModelId}
            confirmDeleteId={confirmDeleteId}
            pendingSwitchId={pendingSwitchId}
            recommendedModelId={recommendedModelId}
            cacheStatusMap={cacheStatusMap}
            onSelectModel={onSelectModel}
            onDelete={onRequestDelete}
            onConfirmDelete={onConfirmDelete}
            onCancelDelete={onCancelDelete}
            onConfirmSwitch={onConfirmSwitch}
            onCancelSwitch={onCancelSwitch}
            currentModelDisplayName={currentModelDisplayName}
            isLoading={isLoading}
            isSwitching={isSwitching}
            isDeleting={isDeleting}
            error={error}
            loadedModel={loadedModel}
            compatibilityIssue={undefined}
            downloadingModelId={downloadingModelId}
            downloadProgress={downloadProgress}
          />
        ))}

        <CloudModelsSection onSwitchToCloud={onSwitchToCloud} />
      </div>

      <StorageFooter
        totalCached={totalCached}
        totalCachedSize={totalCachedSize}
        currentModelId={currentModelId}
        isLoading={isLoading}
        onResetConfig={onResetConfig}
      />
    </div>
  );
}
