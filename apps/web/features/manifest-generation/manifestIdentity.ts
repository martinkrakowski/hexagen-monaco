import yaml from "js-yaml";

/** The project-identity fields a manifest carries at its top level. */
export interface ManifestIdentity {
  /** Top-level `system` name (mirrors governance.workspaceName). */
  readonly system: string;
  /** Top-level `scope` namespace (mirrors governance.namespacePrefix). */
  readonly scope?: string;
}

/**
 * Rewrite a manifest YAML string's top-level identity fields (`system`, and
 * `scope` when provided).
 *
 * The Create streams seed `governance.workspaceName`/`namespacePrefix` in the
 * parsed form data from the user-entered project name, but the manifest *string*
 * that is previewed (Approve screen reads `system`/`scope`) and saved
 * (`manifestYaml`, later read by governance refresh) is the original. Without
 * this, `formState` and `manifestYaml` disagree until the wizard regenerates.
 *
 * Surgical on purpose: only these top-level fields change, so the AI/imported
 * manifest the user is approving is otherwise preserved verbatim. Returns the
 * input unchanged if it can't be parsed as a YAML object.
 */
export function setManifestIdentity(
  manifestYaml: string,
  identity: ManifestIdentity,
): string {
  try {
    const parsed = yaml.load(manifestYaml);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return manifestYaml;
    }
    const record = parsed as Record<string, unknown>;
    record.system = identity.system;
    if (identity.scope !== undefined) {
      record.scope = identity.scope;
    }
    return yaml.dump(parsed, { lineWidth: -1 });
  } catch {
    return manifestYaml;
  }
}
