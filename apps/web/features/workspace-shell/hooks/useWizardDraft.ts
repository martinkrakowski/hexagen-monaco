"use client";

import { useState, useEffect, useCallback } from "react";
import type { WizardDraft } from "@hexagen/shared";
import type { ProjectConfig } from "@hexagen/project-configuration";
import { getWizardPersistence, getMigrationReady } from "@/lib/wire";
import type { IDBWizardDraftAdapter } from "@/lib/adapters/idb-wizard-draft.adapter";

export function useWizardDraft() {
  const [mounted, setMounted] = useState(false);
  const [draft, setDraft] = useState<WizardDraft | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setMounted(true);
    const load = async () => {
      await getMigrationReady();
      try {
        const persistence = getWizardPersistence();
        if (isIDBAdapter(persistence)) {
          persistence.setProjectId(getActiveProjectId());
        }
        const result = await persistence.loadDraft();
        if (result.success && result.value) {
          setDraft(result.value);
        }
      } catch {
        // No draft exists
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const saveDraft = useCallback(
    async (formState: ProjectConfig, savedAtStep: number): Promise<void> => {
      if (typeof window === "undefined") return;

      const now = Date.now();
      const newDraft: WizardDraft = {
        id: draft?.id ?? crypto.randomUUID(),
        savedAtStep,
        formState: formState as Record<string, unknown>,
        createdAt: draft?.createdAt ?? now,
        updatedAt: now,
      };

      try {
        const persistence = getWizardPersistence();
        const result = await persistence.saveDraft(newDraft);
        if (result.success) {
          setDraft(result.value);
        }
      } catch {
        // Silent fail - best effort
      }
    },
    [draft?.id, draft?.createdAt],
  );

  const clearDraft = useCallback(async (): Promise<void> => {
    if (typeof window === "undefined") return;

    try {
      const persistence = getWizardPersistence();
      const result = await persistence.clearDraft();
      if (result.success) {
        setDraft(null);
      }
    } catch {
      // Silent fail - best effort
    }
  }, []);

  const loadDraft = useCallback(
    async (currentProjectId?: string): Promise<WizardDraft | null> => {
      if (typeof window === "undefined") return null;

      try {
        const persistence = getWizardPersistence();
        if (currentProjectId && isIDBAdapter(persistence)) {
          persistence.setProjectId(currentProjectId);
        }
        const result = await persistence.loadDraft();
        if (result.success && result.value) {
          if (
            currentProjectId &&
            result.value.sessionId &&
            result.value.sessionId !== currentProjectId
          ) {
            await persistence.clearDraft();
            return null;
          }
          return result.value;
        }
      } catch {
        // No draft
      }
      return null;
    },
    [],
  );

  if (!mounted) {
    return {
      draft: null,
      saveDraft: async () => {},
      clearDraft: async () => {},
      loadDraft: async () => null,
      loading: true,
    };
  }

  return {
    draft,
    saveDraft,
    clearDraft,
    loadDraft,
    loading,
  };
}

function isIDBAdapter(adapter: unknown): adapter is IDBWizardDraftAdapter {
  return (
    typeof adapter === "object" &&
    adapter !== null &&
    "setProjectId" in adapter &&
    typeof (adapter as IDBWizardDraftAdapter).setProjectId === "function"
  );
}

function getActiveProjectId(): string {
  if (typeof window === "undefined") return "default";
  try {
    const raw = localStorage.getItem("hexagen-active-workspace");
    if (!raw) return "default";
    const parsed = JSON.parse(raw) as { projectId?: string };
    return parsed.projectId ?? "default";
  } catch {
    return "default";
  }
}
