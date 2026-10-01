import { z } from "zod";
import {
  FilePathString,
  IsoDateTime,
  Repo,
  SchemaVersion,
  SlicePathString,
} from "./common.js";

/**
 * `.hexagen/observed.json`: what a scan found in a client repo, in the repo's
 * own names. Observed is kept separate from proposed, so there is no `type`,
 * `layer`, `plane` or `context` field anywhere and every object is strict.
 *
 * A package at the repo root has `root: "."` and `manifestFile: "package.json"`.
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
    /** The literal "." is the repo root (a repo with no workspaces); else a directory path. */
    root: z.union([z.literal("."), SlicePathString]),
    manifestFile: FilePathString,
  })
  .strict();

const LanguageItem = z
  .object({ name: z.string().min(1), fileCount: z.number().int().min(0) })
  .strict();

const BuildItem = z
  .object({ marker: z.string().min(1), path: FilePathString })
  .strict();

const GeneratedItem = z
  .object({
    path: SlicePathString,
    source: z.enum(["linguist-generated", "header", "gitignored-build-dir"]),
  })
  .strict();

const DontTouchItem = z
  .object({
    path: SlicePathString,
    source: z.enum(["flag", "codeowners"]),
    owner: z.string().min(1).optional(),
  })
  .strict();

const EdgeItem = z
  .object({
    /** Repo-relative file. */
    from: FilePathString,
    /** Repo-relative file or package root; "." is a root package. */
    to: z.union([z.literal("."), SlicePathString]),
    specifier: z.string().min(1),
  })
  .strict();

const UnresolvedItem = z
  .object({
    from: FilePathString,
    specifier: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

/**
 * Edges add a required `unreadLanguages` on the collected arm (empty when every
 * language was read): a language the import pass does not read is named here,
 * so an empty edge list is never a clean bill.
 *
 * Consumers must call `edgesComplete`, never read `collected` alone:
 * `collected: true` with a non-empty `unreadLanguages` is an incomplete list.
 */
const EdgesSection = z.union([
  z
    .object({
      collected: z.literal(true),
      unreadLanguages: z.array(z.string().min(1)),
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

/**
 * True only when the edge list is complete: the section was collected and no
 * language went unread. False when `collected` is false, or when
 * `unreadLanguages` is non-empty.
 */
export function edgesComplete(section: ObservedReport["edges"]): boolean {
  return section.collected && section.unreadLanguages.length === 0;
}
