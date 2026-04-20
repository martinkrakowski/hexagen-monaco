export type AdapterCategory =
  | "API"
  | "UI"
  | "Messaging"
  | "Persistence"
  | "Telemetry"
  | "Infrastructure";

/**
 * Adapter label → category tags, ordered so the first match wins.
 * Pattern substrings are matched case-insensitively.
 *
 * Hoisted out of the inline if/else chain in the original
 * layout-engine to make adding new frameworks (e.g. svelte,
 * cassandra, datadog) a one-line change instead of another branch.
 */
const ADAPTER_CATEGORY_PATTERNS: ReadonlyArray<{
  category: AdapterCategory;
  patterns: readonly string[];
}> = [
  { category: "UI", patterns: ["react", "next", "remix", "vue", "angular"] },
  {
    category: "Messaging",
    patterns: ["messaging", "kafka", "rabbit", "bull", "temporal"],
  },
  {
    category: "Persistence",
    patterns: ["prisma", "typeorm", "mongoose", "drizzle", "sql"],
  },
  {
    category: "Telemetry",
    patterns: ["telemetry", "opentelemetry", "prometheus", "winston"],
  },
];

/**
 * Infers the adapter category from its framework label. North-side
 * adapters default to "API" (REST/GraphQL/etc.), south-side to
 * "Infrastructure"; specific frameworks override via pattern match.
 */
export function classifyAdapterLabel(
  label: string,
  side: "north" | "south",
): AdapterCategory {
  const lower = label.toLowerCase();
  for (const { category, patterns } of ADAPTER_CATEGORY_PATTERNS) {
    if (patterns.some((p) => lower.includes(p))) {
      return category;
    }
  }
  return side === "north" ? "API" : "Infrastructure";
}
