import { z } from "zod";
import type { SavedProject } from "@hexagen/shared";

/**
 * Upper bound for `createdAt` / `updatedAt`: the largest time a JavaScript
 * `Date` can hold, in epoch milliseconds. The legacy numeric `If-Match` (an `updatedAt` token) is
 * held to the same bound (project-route-handlers.ts).
 */
export const MAX_PROJECT_TIMESTAMP = 8_640_000_000_000_000;

export const savedProjectBodySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    schemaVersion: z.number().int().positive(),
    createdAt: z.number().int().min(0).max(MAX_PROJECT_TIMESTAMP),
    updatedAt: z.number().int().min(0).max(MAX_PROJECT_TIMESTAMP),
    formState: z.record(z.unknown()),
    manifestYaml: z.string(),
    githubLink: z.unknown().optional(),
    githubPublishPrefs: z.unknown().optional(),
    layers: z.array(z.unknown()).optional(),
    // Optional: an absent value means "greenfield" (see `projectMode`).
    mode: z.enum(["greenfield", "brownfield"]).optional(),
  })
  .passthrough();

export function parseSavedProjectBody(
  body: unknown,
): { ok: true; project: SavedProject } | { ok: false; message: string } {
  const parsed = savedProjectBodySchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, message: "Invalid saved project payload" };
  }
  return { ok: true, project: parsed.data as SavedProject };
}
