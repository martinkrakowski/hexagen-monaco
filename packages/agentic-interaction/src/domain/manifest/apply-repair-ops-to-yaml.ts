import yaml from "js-yaml";
import {
  applyManifestOps,
  type RepairOp,
  type ManifestObject,
} from "./apply-repair-ops";
import { YAML_DUMP_OPTIONS } from "./render-yaml";

export interface ApplyOpsToYamlResult {
  yaml: string;
  applied: number;
  skipped: Array<{ op: RepairOp; reason: string }>;
}

/**
 * Pure YAML→YAML convenience over {@link applyManifestOps}: parse the manifest,
 * apply the validated ops to a deep copy, re-serialize with the canonical dump
 * options. Used by the accept-view chat's "apply suggested fix" flow on the
 * client (the op engine is side-effect-free; the package is tree-shaken into the
 * web bundle). A manifest that doesn't parse is returned unchanged with every op
 * reported as skipped — never throws. js-yaml does not preserve comments, which
 * is fine for the generated, read-only manifest YAML.
 */
export function applyRepairOpsToYaml(
  yamlString: string,
  ops: RepairOp[],
): ApplyOpsToYamlResult {
  let manifest: ManifestObject;
  try {
    const loaded = yaml.load(yamlString);
    if (!loaded || typeof loaded !== "object") {
      return {
        yaml: yamlString,
        applied: 0,
        skipped: ops.map((op) => ({
          op,
          reason: "manifest YAML is not an object",
        })),
      };
    }
    manifest = loaded as ManifestObject;
  } catch {
    return {
      yaml: yamlString,
      applied: 0,
      skipped: ops.map((op) => ({ op, reason: "manifest YAML did not parse" })),
    };
  }

  const {
    manifest: edited,
    applied,
    skipped,
  } = applyManifestOps(manifest, ops);
  return { yaml: yaml.dump(edited, YAML_DUMP_OPTIONS), applied, skipped };
}
