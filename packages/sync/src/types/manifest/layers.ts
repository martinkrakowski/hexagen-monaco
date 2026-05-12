export interface DomainLayer {
  entities?: string[];
  value_objects?: string[];
  domain_services?: string[];
  ports?: {
    in?: string[];
    out?: string[];
  };
}

export interface PortDefinition {
  name: string;
  owner?: string;
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
