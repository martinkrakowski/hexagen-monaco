import { z } from "zod";

export const projectIdSchema = z.string().uuid("Invalid project ID format");

export type ProjectId = z.infer<typeof projectIdSchema>;
