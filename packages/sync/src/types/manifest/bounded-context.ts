export type BoundedContextType =
  | "shared-kernel"
  | "core"
  | "supporting"
  | "driver";

export interface BoundedContextGenerator {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  tsConfig?: import("./monorepo.js").TsConfigTemplate;
  packageJson?: Record<string, unknown>;
  eslint?: import("./monorepo.js").EslintConfig;
  stubs?: {
    naming?: import("./generator.js").StubNaming;
  };
}

export interface BoundedContextWiring {
  description?: string;
}

export interface BoundedContext {
  name: string;
  type?: BoundedContextType;
  description?: string;
  layers?: import("./layers.js").BoundedContextLayers;
  depends_on?: string[];
  driver_for?: string;
  wiring?: string[];
  generator?: BoundedContextGenerator;
  packageJson?: Record<string, unknown>;
}
