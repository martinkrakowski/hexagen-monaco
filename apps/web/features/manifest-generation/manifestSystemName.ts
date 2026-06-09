import yaml from "js-yaml";

/**
 * Rewrite a manifest YAML string's top-level `system` name.
 *
 * The Create streams seed `governance.workspaceName` in the parsed form data
 * from the user-entered project name, but the manifest *string* that is
 * previewed (Approve screen reads `system`) and saved (`manifestYaml`, later
 * read by governance refresh) is the original. Without this, `formState` and
 * `manifestYaml` disagree on the system name until the wizard regenerates.
 *
 * Surgical on purpose: only the top-level `system` field changes, so the
 * AI/imported manifest the user is approving is otherwise preserved verbatim.
 * Returns the input unchanged if it can't be parsed as a YAML object.
 */
export function setManifestSystemName(
  manifestYaml: string,
  systemName: string,
): string {
  try {
    const parsed = yaml.load(manifestYaml);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return manifestYaml;
    }
    (parsed as Record<string, unknown>).system = systemName;
    return yaml.dump(parsed, { lineWidth: -1 });
  } catch {
    return manifestYaml;
  }
}
