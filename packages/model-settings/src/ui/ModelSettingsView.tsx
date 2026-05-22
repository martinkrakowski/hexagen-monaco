"use client";

import { useReducer, useEffect, useMemo } from "react";
import {
  LOCAL_MODELS,
  getModelDescriptor,
  recommendModel,
} from "@hexagen/local-llm";
import type { DomainModelId, ModelMetadata } from "@hexagen/local-llm";
import { useHardwareDetection } from "./useHardwareDetection";
import { Cloud, CheckCircle2 } from "lucide-react";

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
    try {
      await onSwitchModel(modelId);
      setPendingSwitchId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch model");
    } finally {
      setIsSwitching(false);
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
                      {serverModelName || "gpt-4o-mini"}
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
          />
        )}

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
