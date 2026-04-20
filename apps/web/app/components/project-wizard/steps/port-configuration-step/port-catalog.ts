import type { PortConfiguration } from "@hexagen/project-configuration";

export type InboundPortValue = PortConfiguration["inboundPorts"][number];
export type OutboundPortValue = PortConfiguration["outboundPorts"][number];

export interface PortCatalogEntry<T extends string> {
  value: T;
  label: string;
}

/**
 * The set of driving (inbound) adapters users can enable for a
 * bounded context. Values are typed as the exact InboundPortValue
 * union so consumers don't need `as never` casts when filtering.
 */
export const INBOUND_PORTS: ReadonlyArray<PortCatalogEntry<InboundPortValue>> =
  [
    { value: "rest-controller", label: "REST Controller" },
    { value: "graphql-resolver", label: "GraphQL Resolver" },
    { value: "event-listener", label: "Event/Queue Listener" },
    { value: "cli-command", label: "CLI Command" },
  ];

/**
 * The set of driven (outbound) adapters a bounded context can call.
 */
export const OUTBOUND_PORTS: ReadonlyArray<
  PortCatalogEntry<OutboundPortValue>
> = [
  { value: "relational-db", label: "Relational DB Repository" },
  { value: "document-db", label: "Document DB Repository" },
  { value: "external-service-client", label: "External Service Client" },
  { value: "message-publisher", label: "Message Publisher" },
];
