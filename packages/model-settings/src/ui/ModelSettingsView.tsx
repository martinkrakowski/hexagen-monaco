"use client";

import { useReducer, useEffect, useMemo, useState } from "react";
import {
  LOCAL_MODELS,
  getModelDescriptor,
  recommendModel,
} from "@hexagen/local-llm/client";
import type { DomainModelId, ModelMetadata } from "@hexagen/local-llm/client";
import { useHardwareDetection } from "./useHardwareDetection";

import {
  ModelSettingsPanel,
  type ModelTierGroup,
} from "./model-settings/model-settings-panel";

/**
 * HEX-022 — this is the CONTAINER half of the model settings screen. It owns
 * every seam the presentational half must not have: the cache probe, the
 * engine switch/delete transports, hardware detection and the recommendation
 * use case. It renders `ModelSettingsPanel`, whose props type structurally
 * refuses all four (see `NoModelTransport`).
 *
 * The public prop signature is unchanged, so the split is invisible to the
 * three call sites that mount this component.
 */
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
  /** The server model answering assistant questions (chat/governance). */
  serverModelName?: string;
  /**
   * The server model serving manifest GENERATION — may differ from
   * serverModelName (the two run on separate provider chains). When absent,
   * the card falls back to the single-model presentation.
   */
  generationModelName?: string;
  downloadingModelId?: DomainModelId | null;
  downloadProgress?: number;
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

/**
 * Tier layout, projected from the catalog once. Empty tiers are dropped here
 * rather than guarded at each render site, which is why the panel can render
 * `tiers.map(...)` unconditionally.
 */
const TIER_ORDER: ReadonlyArray<{ title: string; tier: string }> = [
  { title: "Desktop", tier: "desktop-high" },
  { title: "Compact", tier: "desktop-compact" },
  { title: "Ultra-Light", tier: "ultra-light" },
];

const MODEL_TIERS: readonly ModelTierGroup[] = TIER_ORDER.map(
  ({ title, tier }) => ({
    title,
    descriptors: LOCAL_MODELS.filter((m) => m.tier === tier),
  }),
).filter((group) => group.descriptors.length > 0);

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
  generationModelName,
  downloadingModelId,
  downloadProgress,
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

  const [simulatedDownload, setSimulatedDownload] = useState<{
    modelId: DomainModelId;
    progress: number;
    estimatedDuration: number;
    startTime: number;
  } | null>(null);

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
    }

    try {
      const isNowCached = await hasModelInCache(modelId);
      dispatch({
        type: "UPDATE_CACHE_ENTRY",
        payload: {
          modelId,
          entry: { modelId, isCached: isNowCached, isChecking: false },
        },
      });
    } catch {
      dispatch({
        type: "UPDATE_CACHE_ENTRY",
        payload: {
          modelId,
          entry: { modelId, isCached: false, isChecking: false },
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
    <ModelSettingsPanel
      tiers={MODEL_TIERS}
      currentModelId={currentModelId}
      currentModelDisplayName={currentModelDisplayName}
      selectedModelId={selectedModelId}
      loadedModel={loadedModel}
      recommendedModelId={recommendedModelId}
      cacheStatusMap={cacheStatus}
      totalCached={totalCached}
      totalCachedSize={totalCachedSize}
      confirmDeleteId={confirmDeleteId}
      pendingSwitchId={pendingSwitchId}
      isLoading={isLoading}
      isSwitching={isSwitching}
      isDeleting={isDeleting}
      error={error}
      downloadingModelId={actualDownloadingModelId}
      downloadProgress={actualDownloadProgress}
      hasServerApiKey={hasServerApiKey}
      serverModelName={serverModelName}
      generationModelName={generationModelName}
      hideHeader={hideHeader}
      requiresModelWarning={requiresModelWarning}
      // The async orchestration stays here; the panel only ever sees
      // fire-and-forget intents.
      onSelectModel={(modelId) => {
        void handleSelectModel(modelId);
      }}
      onRequestDelete={setConfirmDeleteId}
      onConfirmDelete={(modelId) => {
        void handleDelete(modelId);
      }}
      onCancelDelete={() => setConfirmDeleteId(null)}
      onConfirmSwitch={() => {
        void handleConfirmSwitch();
      }}
      onCancelSwitch={() => setPendingSwitchId(null)}
      onBack={onBack}
      onResetConfig={onResetConfig}
      onSwitchToCloud={onSwitchToCloud}
    />
  );
}
