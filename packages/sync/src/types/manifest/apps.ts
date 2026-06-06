export type AppDriver = "next.js" | "fastify" | "express" | "cli";

export type AppFramework =
  | "next.js"
  | "fastify"
  | "express"
  | "plain-ts"
  | "nitro";

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
  /**
   * Additional root-relative files beyond the single `entryPoint` (e.g. Nitro's
   * `nitro.config.ts`). Each is interpolated and written with the same path
   * containment as `entryPoint`.
   */
  extraFiles?: AppEntryPoint[];
}

export interface AppsGeneratorConfig {
  enabled?: boolean;
  frameworks?: Partial<Record<AppFramework, AppFrameworkConfig>>;
}
