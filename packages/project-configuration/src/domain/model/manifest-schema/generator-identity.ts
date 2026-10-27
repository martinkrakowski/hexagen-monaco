/**
 * The value `generator.name` carries in a manifest written by hexagen
 * (the PUBLISHED package name, not the internal `@hexagen/sync`). Consumers
 * read it to tell a hexagen manifest from another tool's file in
 * `.architecture/`. Absence = a legacy manifest, still fully valid.
 */
export const HEXAGEN_GENERATOR_NAME = "@hexagen-monaco/sync";
