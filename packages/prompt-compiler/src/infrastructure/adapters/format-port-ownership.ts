/**
 * DOS-2.1: render every port, in a deterministic order.
 *
 * Both grounded-prompt adapters used `Object.entries(...).slice(0, 10)`
 * under `PORT OWNERSHIP (selected):`. The live map from
 * `apps/web/app/api/llm/context/route.ts` is already complete; the window
 * dropped 85 of 95 entries and, because `Object.entries` follows insertion
 * order, could evict an accurate row in favour of a phantom. Completeness
 * is not the interesting property — a truncated, non-deterministic window
 * is how the model was shown the wrong owners.
 *
 * Sort by port name so the listing cannot silently depend on map order.
 * Do not re-introduce a numeric cap here.
 */
export function formatPortOwnershipLines(
  ports: Record<string, string>,
): string {
  return Object.entries(ports)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([port, owner]) => `  - ${port} → ${owner}`)
    .join("\n");
}
