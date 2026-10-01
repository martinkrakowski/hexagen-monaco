import { z } from "zod";
import { IsoDateTime, Repo, SchemaVersion } from "./common.js";

/**
 * `.hexagen/observed.json`: what a scan found in a client repo, in the repo's
 * own names. Observed is kept separate from proposed, so there is no `type`,
 * `layer`, `plane` or `context` field anywhere and every object is strict.
 *
 * Each section is a union with a `collected: false` arm that carries a reason,
 * so an empty list never reads as a clean tree.
 */

/** A section: items when collected, a reason when not. */
function section<T extends z.ZodTypeAny>(item: T) {
  return z.union([
    z.object({ collected: z.literal(true), items: z.array(item) }).strict(),
    z
      .object({ collected: z.literal(false), reason: z.string().min(1) })
      .strict(),
  ]);
}

const PackageItem = z
  .object({
    /** Exactly as written in the package manifest, scope included. */
    name: z.string().min(1),
    root: z.string().min(1),
    manifestFile: z.string().min(1),
  })
  .strict();

const LanguageItem = z
  .object({ name: z.string().min(1), fileCount: z.number().int().min(0) })
  .strict();

const BuildItem = z
  .object({ marker: z.string().min(1), path: z.string().min(1) })
  .strict();

const GeneratedItem = z
  .object({
    path: z.string().min(1),
    source: z.enum(["linguist-generated", "header", "gitignored-build-dir"]),
  })
  .strict();

const DontTouchItem = z
  .object({
    path: z.string().min(1),
    source: z.enum(["flag", "codeowners"]),
    owner: z.string().min(1).optional(),
  })
  .strict();

const EdgeItem = z
  .object({
    /** Repo-relative file. */
    from: z.string().min(1),
    /** Repo-relative file or package root. */
    to: z.string().min(1),
    specifier: z.string().min(1),
  })
  .strict();

const UnresolvedItem = z
  .object({
    from: z.string().min(1),
    specifier: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

/**
 * Edges add `unreadLanguages` on the collected arm: a language the import pass
 * does not read is named here, so an empty edge list is never a clean bill.
 */
const EdgesSection = z.union([
  z
    .object({
      collected: z.literal(true),
      unreadLanguages: z.array(z.string().min(1)).optional(),
      items: z.array(EdgeItem),
    })
    .strict(),
  z.object({ collected: z.literal(false), reason: z.string().min(1) }).strict(),
]);

const Limits = z
  .object({
    truncated: z.boolean(),
    reasons: z.array(z.string().min(1)),
    maxFiles: z.number().int().positive().optional(),
  })
  .strict();

export const ObservedReport = z
  .object({
    schemaVersion: SchemaVersion,
    repo: Repo,
    generatedAt: IsoDateTime,
    packages: section(PackageItem),
    languages: section(LanguageItem),
    build: section(BuildItem),
    generated: section(GeneratedItem),
    dontTouch: section(DontTouchItem),
    edges: EdgesSection,
    unresolved: section(UnresolvedItem),
    limits: Limits,
  })
  .strict();

export type ObservedReport = z.infer<typeof ObservedReport>;
