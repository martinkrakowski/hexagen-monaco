import type {
  ManifestViewData,
  ValidationItem,
} from "@hexagen/manifest-generation";
import type { StageValidationReport } from "../../app/lib/useStagedGenerationStream";

/**
 * Parser items produced by the fuzzy port→adapter name-containment heuristics
 * (manifest-view-data-parser: "Zero Adapters" / "Unconnected Ports"). They
 * cannot see server-side declared bindings, so on a server-validated manifest
 * they are advisory display information, never an approval gate — the alvaro
 * field test showed them flagging (and the fixer padding) manifests whose
 * bindings the pipeline had already validated.
 */
export function isConnectivityHeuristicItem(item: ValidationItem): boolean {
  return (
    item.title.includes("Zero Adapters") || item.title.includes("Unconnected")
  );
}

/**
 * Display projection for a manifest that carries a server validation report:
 * connectivity-heuristic FAILs are downgraded to warnings so the Validation
 * tab (and its "Cannot Approve" summary) agrees with the approve gate below.
 * Everything else renders unchanged.
 */
export function toAdvisoryValidationItems(
  items: ValidationItem[],
): ValidationItem[] {
  return items.map((item) =>
    item.status === "fail" && isConnectivityHeuristicItem(item)
      ? {
          ...item,
          status: "warn" as const,
          description: `${item.description} Advisory only: the server pipeline validated this manifest against its declared bindings, which name-based matching cannot see.`,
        }
      : item,
  );
}

/**
 * The approve gate (import round-trip integrity, Item 3.3). Without a server
 * report any parser FAIL blocks — the heuristics are the only validation
 * there is. With a report, exactly two things block: YAML that no longer
 * parses at all, and a server report that itself failed. The connectivity
 * heuristics are advisory in that case (see above): gating on them while the
 * auto-fixer is also gated off would brick the approve button for
 * alvaro-class manifests.
 */
export function computeHasBlockingFailures(
  viewData: ManifestViewData,
  validationReport: StageValidationReport | null,
): boolean {
  if (!validationReport) {
    return viewData.validationItems.some((v) => v.status === "fail");
  }
  return (
    validationReport.passed === false ||
    viewData.validationItems.some(
      (v) => v.status === "fail" && v.title === "Invalid YAML",
    )
  );
}
