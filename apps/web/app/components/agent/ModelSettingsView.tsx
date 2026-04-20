"use client";

import { useState, useEffect } from "react";
import { LOCAL_MODELS, getModelDescriptor } from "@/config/models";
import type { DomainModelId, ModelMetadata } from "@hexagen/local-llm";
import { useHardwareDetection } from "@/hooks/useHardwareDetection";
import { recommendModel, checkCompatibility } from "@/lib/model-recommendation";

import {
  ModelSettingsHeader,
  WarningBanner,
  ModelTierSection,
  CloudModelsSection,
  StorageFooter,
} from "./model-settings";

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
}

interface CacheStatusEntry {
  modelId: DomainModelId;
  isCached: boolean;
  isChecking: boolean;
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
}: ModelSettingsViewProps) {
  const [cacheStatus, setCacheStatus] = useState<
    Map<DomainModelId, CacheStatusEntry>
  >(new Map());
  const [confirmDeleteId, setConfirmDeleteId] = useState<DomainModelId | null>(
    null,
  );
  const [pendingSwitchId, setPendingSwitchId] = useState<DomainModelId | null>(
    null,
  );
  const [isSwitching, setIsSwitching] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentModelDisplayName = currentModelId
    ? (getModelDescriptor(currentModelId)?.displayName ?? null)
    : null;

  const { profile: hardwareProfile, isDetecting: isDetectingHardware } =
    useHardwareDetection();
  const [recommendedModelId, setRecommendedModelId] =
    useState<DomainModelId | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<DomainModelId | null>(
    currentModelId,
  );
  const [prevCurrentModelId, setPrevCurrentModelId] =
    useState<DomainModelId | null>(currentModelId);

  if (prevCurrentModelId !== currentModelId) {
    setPrevCurrentModelId(currentModelId);
    setSelectedModelId(currentModelId);
  }

  useEffect(() => {
    if (hardwareProfile && !isDetectingHardware) {
      const recommendation = recommendModel(hardwareProfile, LOCAL_MODELS);
      setRecommendedModelId(recommendation?.modelId ?? null);
    }
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
      setCacheStatus((prev) => {
        const newStatus = new Map(prev);
        newStatus.set(modelId, { modelId, isCached, isChecking: false });
        return newStatus;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete model");
    } finally {
      setIsDeleting(false);
    }
  };

  const totalCached = Array.from(cacheStatus.values()).filter(
    (s) => s.isCached,
  ).length;
  const totalCachedSize = LOCAL_MODELS.reduce((sum, model) => {
    if (cacheStatus.get(model.modelId)?.isCached) {
      return sum + model.downloadSizeGB;
    }
    return sum;
  }, 0);

  const getCompatibility = (modelId: DomainModelId) => {
    const descriptor = LOCAL_MODELS.find((m) => m.modelId === modelId);
    if (!descriptor || selectedModelId !== modelId) return undefined;
    return checkCompatibility(descriptor, hardwareProfile) ?? undefined;
  };

  return (
    <div className="h-full flex flex-col bg-card">
      <ModelSettingsHeader onBack={onBack} />

      {requiresModelWarning && <WarningBanner />}

      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-5">
        {recommendedModelId && !isDetectingHardware && (
          <div className="mb-6">
            <h2 className="text-[12px] font-semibold text-muted-foreground uppercase mb-3">
              ✨ Recommended for Your System
            </h2>
            {LOCAL_MODELS.find((m) => m.modelId === recommendedModelId) && (
              <ModelTierSection
                title=""
                descriptors={[
                  LOCAL_MODELS.find((m) => m.modelId === recommendedModelId)!,
                ]}
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
                compatibilityIssue={getCompatibility(recommendedModelId)}
              />
            )}
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
      />
    </div>
  );
}
