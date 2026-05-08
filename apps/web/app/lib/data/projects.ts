import { get, set } from "idb-keyval";
import type { SavedProject } from "@hexagen/shared";

const SAVED_PROJECTS_KEY = "hexagen:saved-projects";

export async function getProjectById(id: string): Promise<SavedProject | null> {
  try {
    const data = await get<SavedProject[]>(SAVED_PROJECTS_KEY);
    if (!data || !Array.isArray(data)) return null;
    return data.find((p) => p.id === id) ?? null;
  } catch {
    return null;
  }
}

export async function updateProjectName(
  id: string,
  newName: string,
): Promise<SavedProject | null> {
  try {
    const data = await get<SavedProject[]>(SAVED_PROJECTS_KEY);
    if (!data || !Array.isArray(data)) return null;

    const index = data.findIndex((p) => p.id === id);
    if (index === -1) return null;

    const updated: SavedProject = {
      ...data[index],
      name: newName,
      updatedAt: Date.now(),
    };

    data[index] = updated;
    await set(SAVED_PROJECTS_KEY, data);
    return updated;
  } catch {
    return null;
  }
}
