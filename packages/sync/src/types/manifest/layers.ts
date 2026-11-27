export interface DomainLayer {
  entities?: string[];
  value_objects?: string[];
  domain_services?: string[];
  ports?: {
    in?: string[];
    out?: string[];
  };
}

/**
 * One field-kind node of a typed port contract, matching the downstream
 * `@fleet/shared` `CodecSchema` kinds. Objects are always exact; `enum.values`
 * is dense; bounds (`maxLength`, `maxItems`) are explicit positive integers.
 */
export type PortContractField =
  | {
      kind: "object";
      exact: true;
      fields: Record<string, PortContractField | { optional: PortContractField }>;
    }
  | { kind: "array"; items: PortContractField; maxItems: number }
  | { kind: "string"; maxLength: number; pattern?: string }
  | { kind: "integer" | "number"; min?: number; max?: number }
  | { kind: "boolean" }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "nullable"; of: PortContractField };

/** Typed request shape of a port: `{ request: PortContractField }` exactly. */
export interface PortContract {
  request: PortContractField;
}

export interface PortDefinition {
  name: string;
  owner?: string;
  contracts?: PortContract;
}

export type LegacyOrNewPort = string | PortDefinition;

export interface ApplicationPorts {
  in?: LegacyOrNewPort[];
  out?: LegacyOrNewPort[];
}

export interface ApplicationLayer {
  use_cases?: string[];
  ports?: ApplicationPorts;
  factories?: string[];
}

export interface InfrastructureLayer {
  adapters?: string[];
}

export interface BoundedContextLayers {
  domain?: DomainLayer;
  application?: ApplicationLayer;
  infrastructure?: InfrastructureLayer;
}
