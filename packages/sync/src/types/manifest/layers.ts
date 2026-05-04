export interface DomainLayer {
  entities?: string[];
  value_objects?: string[];
  domain_services?: string[];
  ports?: {
    in?: string[];
    out?: string[];
  };
}

export interface ApplicationPorts {
  in?: string[];
  out?: string[];
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
