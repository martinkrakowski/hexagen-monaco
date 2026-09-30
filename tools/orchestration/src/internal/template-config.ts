/**
 * The one field of a project's `.hexagen-template-config.json` this package
 * reads.
 *
 * The record itself belongs to `@hexagen/template-engine`
 * (`TemplateConfig` / `TemplateInstallRecord` in
 * `packages/template-engine/src/domain/template-config.ts`). It is re-declared
 * here as a structural subset rather than imported, for the same reason the
 * arch-linter keeps its manifest schema out of itself: the published bin must
 * not carry a private workspace dependency in order to read one boolean.
 *
 * Only what is read is declared. `init` reads the `agents_md` answer and
 * nothing else, so a record with any other shape still works.
 */
export const TEMPLATE_CONFIG_FILE = ".hexagen-template-config.json";
