import { z } from "zod";
import type { SavedProject } from "@hexagen/shared";

export const savedProjectBodySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    schemaVersion: z.number().int().positive(),
    createdAt: z.number(),
    updatedAt: z.number(),
    formState: z.record(z.unknown()),
    manifestYaml: z.string(),
    githubLink: z.unknown().optional(),
    githubPublishPrefs: z.unknown().optional(),
    layers: z.array(z.unknown()).optional(),
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
