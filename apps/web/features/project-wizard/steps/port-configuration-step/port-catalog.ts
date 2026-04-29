import type { PortConfiguration } from "@hexagen/project-configuration";

export type InboundPortValue = PortConfiguration["inboundPorts"][number];
export type OutboundPortValue = PortConfiguration["outboundPorts"][number];

/**
 * Compass classification for outbound ports. Outbound (driven) adapters split
 * across two sides of the hexagon:
 *   - "east"  → State & Storage (persistence: DBs, in-memory stores)
 *   - "south" → External Integrations (3rd-party APIs, payment, email, queues)
 */
export type OutboundCompass = "east" | "south";

export interface PortCatalogEntry<T extends string> {
  value: T;
  label: string;
}

export interface OutboundPortCatalogEntry extends PortCatalogEntry<OutboundPortValue> {
  compass: OutboundCompass;
}

/**
 * Driving (inbound) adapters — machine-driven entry points. All inbound ports
 * are "APIs" in the compass model and render on the NORTH side of the hex.
 * (Presentation / UI inputs are modeled via the separate `uiFramework` field
 * and render on the WEST side.)
 */
export const INBOUND_PORTS: ReadonlyArray<PortCatalogEntry<InboundPortValue>> =
  [
    { value: "rest-controller", label: "REST Controller" },
    { value: "graphql-resolver", label: "GraphQL Resolver" },
    { value: "event-listener", label: "Event/Queue Listener" },
    { value: "cli-command", label: "CLI Command" },
  ];

/**
 * Driven (outbound) adapters split across the two driven sides. `compass`
 * drives both the wizard UI grouping and the canvas generator's side
 * assignment so the two views stay consistent.
 */
export const OUTBOUND_PORTS: ReadonlyArray<OutboundPortCatalogEntry> = [
  {
    value: "relational-db",
    label: "Relational DB Repository",
    compass: "east",
  },
  { value: "document-db", label: "Document DB Repository", compass: "east" },
  {
    value: "external-service-client",
    label: "External Service Client",
    compass: "south",
  },
  { value: "message-publisher", label: "Message Publisher", compass: "south" },
];

/**
 * Helper: classify an outbound port value to its compass side. Defaults to
 * "south" (External Integrations) for unknown values.
 */
export function outboundCompassFor(value: OutboundPortValue): OutboundCompass {
  return (
    OUTBOUND_PORTS.find((entry) => entry.value === value)?.compass ?? "south"
  );
}
