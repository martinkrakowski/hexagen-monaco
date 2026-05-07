import { get, set } from "idb-keyval";

const LEGACY_LS_KEY = "hexagen-wizard-draft";
const IDB_DRAFT_PREFIX = "hexagen:wizard-draft:";

export async function migrateWizardDraftFromLocalStorage(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const raw = localStorage.getItem(LEGACY_LS_KEY);
  if (!raw) return false;

  try {
    const draft = JSON.parse(raw) as { id?: string; sessionId?: string };
    const projectId = draft.sessionId ?? draft.id ?? "unknown";
    const idbKey = `${IDB_DRAFT_PREFIX}${projectId}`;
    await set(idbKey, draft);

    const readBack = await get<{ id?: string; sessionId?: string }>(idbKey);
    if (!readBack || readBack.id !== draft.id) {
      return false;
    }

    localStorage.removeItem(LEGACY_LS_KEY);
    return true;
  } catch {
    return false;
  }
}
