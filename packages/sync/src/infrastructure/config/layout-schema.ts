import { z } from "zod";

export const layoutSchema = z
  .object({
    contexts: z.string().optional(),
    root: z.string().optional(),
    layers: z.array(z.string()).optional(),
    ignore: z.array(z.string()).optional(),
  })
  .strict();

export type LayoutConfig = z.infer<typeof layoutSchema>;
