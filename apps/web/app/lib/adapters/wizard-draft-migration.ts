import { set } from "idb-keyval";

const LEGACY_LS_KEY = "hexagen-wizard-draft";
const IDB_DRAFT_PREFIX = "hexagen:wizard-draft:";

export async function migrateWizardDraftFromLocalStorage(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const raw = localStorage.getItem(LEGACY_LS_KEY);
  if (!raw) return false;

  try {
    const draft = JSON.parse(raw) as { id?: string; sessionId?: string };
    const projectId = draft.sessionId ?? draft.id ?? "unknown";
    await set(`${IDB_DRAFT_PREFIX}${projectId}`, draft);
    localStorage.removeItem(LEGACY_LS_KEY);
    return true;
  } catch {
    return false;
  }
}
