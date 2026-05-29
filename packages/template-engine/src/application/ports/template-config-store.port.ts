import type { TemplateConfig } from "../../domain/index.js";

export interface TemplateConfigStorePort {
  load(projectRoot: string): Promise<TemplateConfig>;
  save(projectRoot: string, config: TemplateConfig): Promise<void>;
}
