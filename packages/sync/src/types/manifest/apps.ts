export type AppDriver = "next.js" | "fastify" | "express" | "cli";

export type AppFramework = "next.js" | "fastify" | "express" | "plain-ts";

export interface App {
  name: string;
  driver?: AppDriver;
  framework?: AppFramework;
  version?: string;
  description?: string;
  depends_on?: string[];
}

export interface AppEntryPoint {
  path: string;
  template?: string;
}

export interface AppFrameworkConfig {
  packageJson?: import("./monorepo.js").FileTemplate;
  tsConfig?: import("./monorepo.js").TsConfigTemplate;
  entryPoint?: AppEntryPoint;
}

export interface AppsGeneratorConfig {
  enabled?: boolean;
  frameworks?: Partial<Record<AppFramework, AppFrameworkConfig>>;
}
