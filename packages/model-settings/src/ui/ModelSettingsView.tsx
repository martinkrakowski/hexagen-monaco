"use client";

import { useReducer, useEffect, useMemo, useState } from "react";
import {
  LOCAL_MODELS,
  getModelDescriptor,
  recommendModel,
  getClientProviders,
} from "@hexagen/local-llm";
import type { DomainModelId, ModelMetadata } from "@hexagen/local-llm";
import {
  LocalStorageTandemConfigAdapter,
  DEFAULT_TANDEM_CONFIG,
} from "@hexagen/tandem-execution";
import type { TandemConfig } from "@hexagen/tandem-execution";
import { useHardwareDetection } from "./useHardwareDetection";
import { Cloud, CheckCircle2 } from "lucide-react";
import { TandemModeBadge } from "./model-settings/tandem-mode-badge";

import {
  ModelSettingsHeader,
  WarningBanner,
  ModelTierSection,
  CloudModelsSection,
  StorageFooter,
} from "./index";

interface ModelSettingsViewProps {
  currentModelId: DomainModelId | null;
  loadedModel: ModelMetadata | null;
  messagesLength: number;
  onSwitchModel: (modelId: DomainModelId) => Promise<void>;
  onDeleteModel: (modelId: DomainModelId) => Promise<void>;
  hasModelInCache: (modelId: DomainModelId) => Promise<boolean>;
  onBack?: () => void;
  isLoading: boolean;
  onSwitchToCloud?: () => void;
  requiresModelWarning?: boolean;
  onResetConfig?: () => void;
  hideHeader?: boolean;
  /** True if server-side LLM is detected and available */
  hasServerApiKey?: boolean;
  /** The active server LLM model (e.g., "gpt-4o-mini") */
  serverModelName?: string;
  downloadingModelId?: DomainModelId | null;
  downloadProgress?: number;
  tandemStatus?: "active" | "degraded" | "unavailable" | "off";
  /** Called after a successful tandem config write — use to record the sentinel. */
  onConfigSaved?: () => void;
  /** Called when tandem config is reset — use to switch mode back to local/cloud. */
  onTandemDisabled?: () => void;
}

interface CacheStatusEntry {
  modelId: DomainModelId;
  isCached: boolean;
  isChecking: boolean;
}

interface ModelSettingsState {
  cacheStatus: Map<DomainModelId, CacheStatusEntry>;
  confirmDeleteId: DomainModelId | null;
  pendingSwitchId: DomainModelId | null;
  isSwitching: boolean;
  isDeleting: boolean;
  error: string | null;
  selectedModelId: DomainModelId | null;
}

type ModelSettingsAction =
  | { type: "SET_CACHE_STATUS"; payload: Map<DomainModelId, CacheStatusEntry> }
  | { type: "SET_CONFIRM_DELETE_ID"; payload: DomainModelId | null }
  | { type: "SET_PENDING_SWITCH_ID"; payload: DomainModelId | null }
  | { type: "SET_IS_SWITCHING"; payload: boolean }
  | { type: "SET_IS_DELETING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "SET_SELECTED_MODEL_ID"; payload: DomainModelId | null }
  | {
      type: "UPDATE_CACHE_ENTRY";
      payload: { modelId: DomainModelId; entry: CacheStatusEntry };
    };

function modelSettingsReducer(
  state: ModelSettingsState,
  action: ModelSettingsAction,
): ModelSettingsState {
  switch (action.type) {
    case "SET_CACHE_STATUS":
      return { ...state, cacheStatus: action.payload };
    case "SET_CONFIRM_DELETE_ID":
      return { ...state, confirmDeleteId: action.payload };
    case "SET_PENDING_SWITCH_ID":
      return { ...state, pendingSwitchId: action.payload };
    case "SET_IS_SWITCHING":
      return { ...state, isSwitching: action.payload };
    case "SET_IS_DELETING":
      return { ...state, isDeleting: action.payload };
    case "SET_ERROR":
      return { ...state, error: action.payload };
    case "SET_SELECTED_MODEL_ID":
      return { ...state, selectedModelId: action.payload };
    case "UPDATE_CACHE_ENTRY": {
      const newStatus = new Map(state.cacheStatus);
      newStatus.set(action.payload.modelId, action.payload.entry);
      return { ...state, cacheStatus: newStatus };
    }
    default:
      return state;
  }
}

export function ModelSettingsView({
  currentModelId,
  loadedModel,
  messagesLength,
  onSwitchModel,
  onDeleteModel,
  hasModelInCache,
  onBack,
  isLoading,
  onSwitchToCloud,
  requiresModelWarning,
  onResetConfig,
  hideHeader,
  hasServerApiKey = false,
  serverModelName,
  downloadingModelId,
  downloadProgress,
  tandemStatus,
  onConfigSaved,
  onTandemDisabled,
}: ModelSettingsViewProps) {
  const [state, dispatch] = useReducer(modelSettingsReducer, {
    cacheStatus: new Map<DomainModelId, CacheStatusEntry>(),
    confirmDeleteId: null as DomainModelId | null,
    pendingSwitchId: null as DomainModelId | null,
    isSwitching: false,
    isDeleting: false,
    error: null as string | null,
    selectedModelId: currentModelId,
  });

  const {
    cacheStatus,
    confirmDeleteId,
    pendingSwitchId,
    isSwitching,
    isDeleting,
    error,
    selectedModelId,
  } = state;

  const configAdapter = useMemo(
    () => new LocalStorageTandemConfigAdapter(),
    [],
  );

  const [tandemConfig, setTandemConfig] = useState<TandemConfig>(() => {
    // Create a separate instance for the lazy initializer to avoid closure over
    // configAdapter (which is from useMemo evaluated after useState in the same render).
    const result = new LocalStorageTandemConfigAdapter().read();
    return result.success ? result.value : DEFAULT_TANDEM_CONFIG;
  });
  const [showTandemResetConfirm, setShowTandemResetConfirm] = useState(false);
  const [simulatedDownload, setSimulatedDownload] = useState<{
    modelId: DomainModelId;
    progress: number;
    estimatedDuration: number;
    startTime: number;
  } | null>(null);

  const updateTandemConfig = (updates: Partial<TandemConfig>) => {
    setTandemConfig((prev) => {
      const next = { ...prev, ...updates };
      const writeResult = configAdapter.write(next);
      if (!writeResult.success) {
        console.error("Failed to save tandem config", writeResult.error);
        return prev; // revert on write failure
      }
      onConfigSaved?.();
      return next;
    });
  };

  const handleTandemResetConfirmed = () => {
    configAdapter.reset();
    setTandemConfig(DEFAULT_TANDEM_CONFIG);
    setShowTandemResetConfirm(false);
    onTandemDisabled?.();
  };

  const cloudProviders = useMemo(() => {
    try {
      return getClientProviders().filter((p) => p.available);
    } catch (e) {
      console.error("Failed to get client providers", e);
      return [];
    }
  }, []);

  const derivedTandemStatus = useMemo(() => {
    if (tandemStatus) return tandemStatus;
    if (!tandemConfig.enabled) return "off";

    const isLocalModelActive = !!currentModelId;
    const isLocalModelCached = currentModelId
      ? cacheStatus.get(currentModelId)?.isCached
      : false;

    if (!isLocalModelActive || !isLocalModelCached) {
      return "unavailable";
    }

    if (error) {
      return "degraded";
    }

    return "active";
  }, [tandemStatus, tandemConfig.enabled, currentModelId, cacheStatus, error]);

  const currentModelDisplayName = currentModelId
    ? (getModelDescriptor(currentModelId)?.displayName ?? null)
    : null;

  const { profile: hardwareProfile, isDetecting: isDetectingHardware } =
    useHardwareDetection();

  const setters = {
    setCacheStatus: (status: Map<DomainModelId, CacheStatusEntry>) =>
      dispatch({ type: "SET_CACHE_STATUS", payload: status }),
    setConfirmDeleteId: (id: DomainModelId | null) =>
      dispatch({ type: "SET_CONFIRM_DELETE_ID", payload: id }),
    setPendingSwitchId: (id: DomainModelId | null) =>
      dispatch({ type: "SET_PENDING_SWITCH_ID", payload: id }),
    setIsSwitching: (v: boolean) =>
      dispatch({ type: "SET_IS_SWITCHING", payload: v }),
    setIsDeleting: (v: boolean) =>
      dispatch({ type: "SET_IS_DELETING", payload: v }),
    setError: (e: string | null) => dispatch({ type: "SET_ERROR", payload: e }),
    setSelectedModelId: (id: DomainModelId | null) =>
      dispatch({ type: "SET_SELECTED_MODEL_ID", payload: id }),
  };

  const {
    setCacheStatus,
    setConfirmDeleteId,
    setPendingSwitchId,
    setIsSwitching,
    setIsDeleting,
    setError,
  } = setters;

  const recommendedModelId = useMemo(() => {
    if (hardwareProfile && !isDetectingHardware) {
      const recommendation = recommendModel(hardwareProfile, LOCAL_MODELS);
      return recommendation?.modelId ?? null;
    }
    return null;
  }, [hardwareProfile, isDetectingHardware]);

  useEffect(() => {
    const queryCacheStatus = async () => {
      const newStatus = new Map<DomainModelId, CacheStatusEntry>();
      for (const model of LOCAL_MODELS) {
        newStatus.set(model.modelId, {
          modelId: model.modelId,
          isCached: false,
          isChecking: true,
        });
      }
      setCacheStatus(newStatus);

      const results = await Promise.all(
        LOCAL_MODELS.map(async (model) => {
          try {
            const isCached = await hasModelInCache(model.modelId);
            return { modelId: model.modelId, isCached };
          } catch {
            return { modelId: model.modelId, isCached: false };
          }
        }),
      );

      const finalStatus = new Map<DomainModelId, CacheStatusEntry>();
      for (const result of results) {
        finalStatus.set(result.modelId, {
          modelId: result.modelId,
          isCached: result.isCached,
          isChecking: false,
        });
      }
      setCacheStatus(finalStatus);
    };

    queryCacheStatus();
  }, [hasModelInCache]);

  useEffect(() => {
    if (currentModelId && tandemConfig.localModelId !== currentModelId) {
      updateTandemConfig({ localModelId: currentModelId });
    }
  }, [currentModelId, tandemConfig.localModelId]);

  const handleSelectModel = async (modelId: DomainModelId) => {
    if (modelId === currentModelId) return;

    if (messagesLength > 0) {
      setPendingSwitchId(modelId);
      setError(null);
      return;
    }

    await doSwitch(modelId);
  };

  const doSwitch = async (modelId: DomainModelId) => {
    setIsSwitching(true);
    setError(null);

    const isCached = cacheStatus.get(modelId)?.isCached ?? false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    if (!isCached) {
      const descriptor = getModelDescriptor(modelId);
      const size = descriptor?.downloadSizeGB ?? 1.0;
      const estimatedDuration = size * 30; // ~30s per GB
      const startTime = Date.now();

      setSimulatedDownload({
        modelId,
        progress: 0,
        estimatedDuration,
        startTime,
      });

      intervalId = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const progress = Math.min(0.99, elapsed / estimatedDuration);
        setSimulatedDownload((prev) => {
          if (!prev) return null;
          return { ...prev, progress };
        });
      }, 200);
    }

    try {
      await onSwitchModel(modelId);
      setPendingSwitchId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch model");
    } finally {
      if (intervalId) {
        clearInterval(intervalId);
      }
      setSimulatedDownload(null);
      setIsSwitching(false);

      const isNowCached = await hasModelInCache(modelId);
      dispatch({
        type: "UPDATE_CACHE_ENTRY",
        payload: {
          modelId,
          entry: { modelId, isCached: isNowCached, isChecking: false },
        },
      });
    }
  };

  const handleConfirmSwitch = async () => {
    if (pendingSwitchId) {
      await doSwitch(pendingSwitchId);
    }
  };

  const handleDelete = async (modelId: DomainModelId) => {
    setIsDeleting(true);
    setError(null);
    try {
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error("Delete operation timed out")),
          60000,
        ),
      );
      await Promise.race([onDeleteModel(modelId), timeoutPromise]);
      setConfirmDeleteId(null);
      const isCached = await hasModelInCache(modelId);
      dispatch({
        type: "UPDATE_CACHE_ENTRY",
        payload: { modelId, entry: { modelId, isCached, isChecking: false } },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete model");
    } finally {
      setIsDeleting(false);
    }
  };

  const { totalCached, totalCachedSize } = useMemo(() => {
    const cached = Array.from(cacheStatus.values()).filter(
      (s) => s.isCached,
    ).length;
    const cachedSize = LOCAL_MODELS.reduce((sum, model) => {
      if (cacheStatus.get(model.modelId)?.isCached) {
        return sum + model.downloadSizeGB;
      }
      return sum;
    }, 0);
    return { totalCached: cached, totalCachedSize: cachedSize };
  }, [cacheStatus]);

  const actualDownloadingModelId =
    downloadingModelId || simulatedDownload?.modelId || null;
  const actualDownloadProgress = downloadingModelId
    ? (downloadProgress ?? 0)
    : (simulatedDownload?.progress ?? 0);

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
                  A server-side cloud LLM key is configured in the environment
                  variables. The application will use this for high-performance
                  manifest generation.
                </p>
                <div className="pt-3 grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="text-muted-foreground block font-medium">
                      Model Name
                    </span>
                    <span className="font-mono text-foreground font-semibold">
                      {serverModelName ?? "Configured by environment"}
                    </span>
                  </div>
                  <div>
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
        {LOCAL_MODELS.some((m) => m.tier === "desktop-high") && (
          <ModelTierSection
            title="Desktop"
            descriptors={LOCAL_MODELS.filter((m) => m.tier === "desktop-high")}
            currentModelId={currentModelId}
            selectedModelId={selectedModelId}
            confirmDeleteId={confirmDeleteId}
            pendingSwitchId={pendingSwitchId}
            recommendedModelId={recommendedModelId}
            cacheStatusMap={cacheStatus}
            onSelectModel={handleSelectModel}
            onDelete={setConfirmDeleteId}
            onConfirmDelete={(id) => handleDelete(id)}
            onCancelDelete={() => setConfirmDeleteId(null)}
            onConfirmSwitch={handleConfirmSwitch}
            onCancelSwitch={() => setPendingSwitchId(null)}
            currentModelDisplayName={currentModelDisplayName}
            isLoading={isLoading}
            isSwitching={isSwitching}
            isDeleting={isDeleting}
            error={error}
            loadedModel={loadedModel}
            compatibilityIssue={undefined}
            downloadingModelId={actualDownloadingModelId}
            downloadProgress={actualDownloadProgress}
          />
        )}

        {LOCAL_MODELS.some((m) => m.tier === "desktop-compact") && (
          <ModelTierSection
            title="Compact"
            descriptors={LOCAL_MODELS.filter(
              (m) => m.tier === "desktop-compact",
            )}
            currentModelId={currentModelId}
            selectedModelId={selectedModelId}
            confirmDeleteId={confirmDeleteId}
            pendingSwitchId={pendingSwitchId}
            recommendedModelId={recommendedModelId}
            cacheStatusMap={cacheStatus}
            onSelectModel={handleSelectModel}
            onDelete={setConfirmDeleteId}
            onConfirmDelete={(id) => handleDelete(id)}
            onCancelDelete={() => setConfirmDeleteId(null)}
            onConfirmSwitch={handleConfirmSwitch}
            onCancelSwitch={() => setPendingSwitchId(null)}
            currentModelDisplayName={currentModelDisplayName}
            isLoading={isLoading}
            isSwitching={isSwitching}
            isDeleting={isDeleting}
            error={error}
            loadedModel={loadedModel}
            compatibilityIssue={undefined}
            downloadingModelId={actualDownloadingModelId}
            downloadProgress={actualDownloadProgress}
          />
        )}

        {LOCAL_MODELS.some((m) => m.tier === "ultra-light") && (
          <ModelTierSection
            title="Ultra-Light"
            descriptors={LOCAL_MODELS.filter((m) => m.tier === "ultra-light")}
            currentModelId={currentModelId}
            selectedModelId={selectedModelId}
            confirmDeleteId={confirmDeleteId}
            pendingSwitchId={pendingSwitchId}
            recommendedModelId={recommendedModelId}
            cacheStatusMap={cacheStatus}
            onSelectModel={handleSelectModel}
            onDelete={setConfirmDeleteId}
            onConfirmDelete={(id) => handleDelete(id)}
            onCancelDelete={() => setConfirmDeleteId(null)}
            onConfirmSwitch={handleConfirmSwitch}
            onCancelSwitch={() => setPendingSwitchId(null)}
            currentModelDisplayName={currentModelDisplayName}
            isLoading={isLoading}
            isSwitching={isSwitching}
            isDeleting={isDeleting}
            error={error}
            loadedModel={loadedModel}
            compatibilityIssue={undefined}
            downloadingModelId={actualDownloadingModelId}
            downloadProgress={actualDownloadProgress}
          />
        )}

        {/* Tandem Mode Configuration */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase">
              Tandem Mode
            </h2>
            <TandemModeBadge state={derivedTandemStatus} />
          </div>

          <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-foreground">
                  Enable Tandem Mode
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Execute inference locally while leveraging a cloud model for
                  refinement in tandem.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  updateTandemConfig({ enabled: !tandemConfig.enabled })
                }
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  tandemConfig.enabled ? "bg-primary" : "bg-muted-foreground/30"
                }`}
                role="switch"
                aria-checked={tandemConfig.enabled}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-card shadow-lg ring-0 transition duration-200 ease-in-out ${
                    tandemConfig.enabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {tandemConfig.enabled && (
              <div className="pt-3 border-t border-border/40 space-y-4 animate-fade-in-up">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    Cloud Refinement Engine
                  </label>
                  <select
                    value={tandemConfig.refinementEngine}
                    onChange={(e) =>
                      updateTandemConfig({ refinementEngine: e.target.value })
                    }
                    className="w-full text-sm rounded-md border border-input bg-card px-3 py-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-colors"
                  >
                    <option value="ENV">Environment Engine (Default)</option>
                    <option value="BYOK">Bring Your Own Key (BYOK)</option>
                    {cloudProviders.map((prov) => (
                      <option key={prov.id} value={prov.id}>
                        {prov.displayName} Key (BYOK)
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Select the provider or environment configuration to power
                    refinement.
                  </p>
                </div>

                {(tandemConfig.refinementEngine === "BYOK" ||
                  cloudProviders.some(
                    (p) => p.id === tandemConfig.refinementEngine,
                  )) && (
                  <div className="p-3 rounded-lg border border-warning/30 bg-warning/5 text-warning-foreground text-xs leading-relaxed">
                    <span className="font-semibold block mb-0.5">
                      BYOK Notice & Cost Warnings
                    </span>
                    Each tandem conversation turn uses tokens from both your
                    local model and your BYOK API key. Your API provider may
                    charge for all tokens including the enriched context
                    payload.
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    Display Preference
                  </label>
                  <div className="flex rounded-md bg-muted p-1 gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        updateTandemConfig({ displayPreference: "overwrite" })
                      }
                      className={`flex-1 rounded-sm py-1 text-xs font-medium transition-all active:scale-[0.98] ${
                        tandemConfig.displayPreference === "overwrite"
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Overwrite
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateTandemConfig({ displayPreference: "append" })
                      }
                      className={`flex-1 rounded-sm py-1 text-xs font-medium transition-all active:scale-[0.98] ${
                        tandemConfig.displayPreference === "append"
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Append
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Determine if cloud refinement should overwrite or append to
                    local output.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-xs font-medium text-foreground">
                    <span>Stage 1 Timeout</span>
                    <span className="font-mono text-muted-foreground">
                      {tandemConfig.stageOneTimeoutSeconds}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={15}
                    max={300}
                    step={5}
                    value={tandemConfig.stageOneTimeoutSeconds}
                    onChange={(e) =>
                      updateTandemConfig({
                        stageOneTimeoutSeconds: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Maximum time allowed for local draft generation before
                    fallback or timeout (15s to 300s).
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-xs font-medium text-foreground">
                    <span>Memory Headroom</span>
                    <span className="font-mono text-muted-foreground">
                      {tandemConfig.memoryHeadroomMB < 1024
                        ? `${tandemConfig.memoryHeadroomMB} MB`
                        : `${(tandemConfig.memoryHeadroomMB / 1024).toFixed(1)} GB`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={256}
                    max={2048}
                    step={128}
                    value={Math.min(
                      2048,
                      Math.max(256, tandemConfig.memoryHeadroomMB),
                    )}
                    onChange={(e) =>
                      updateTandemConfig({
                        memoryHeadroomMB: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Reserved memory buffer to prevent WebGPU out-of-memory
                    errors (256MB to 2GB).
                  </p>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowTandemResetConfirm(true)}
                    className="text-xs text-destructive hover:text-destructive/80 transition-colors font-medium active:scale-[0.98] py-1 px-2 rounded-md hover:bg-destructive/5"
                  >
                    Reset Tandem Configuration
                  </button>
                </div>
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground/70 italic mt-2 pl-1 leading-normal">
            Tandem Mode settings are saved to this browser only. You will need
            to reconfigure on other devices.
          </p>
        </div>

        <CloudModelsSection onSwitchToCloud={onSwitchToCloud} />
      </div>

      <StorageFooter
        totalCached={totalCached}
        totalCachedSize={totalCachedSize}
        currentModelId={currentModelId}
        isLoading={isLoading}
        onResetConfig={onResetConfig}
      />

      {showTandemResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50">
          <div className="bg-popover text-popover-foreground border border-border rounded-lg p-5 max-w-sm mx-4 shadow-lg animate-fade-in-up">
            <h3 className="text-sm font-semibold text-popover-foreground mb-2">
              Reset Tandem Configuration
            </h3>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              Are you sure you want to reset your Tandem Mode configuration to
              default values?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowTandemResetConfirm(false)}
                className="text-xs px-3 py-1.5 rounded-md border border-border text-foreground hover:bg-muted/60 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleTandemResetConfirmed}
                className="text-xs px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
