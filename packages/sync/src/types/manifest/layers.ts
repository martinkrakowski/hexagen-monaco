export interface DomainLayer {
  entities?: string[];
  value_objects?: string[];
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
