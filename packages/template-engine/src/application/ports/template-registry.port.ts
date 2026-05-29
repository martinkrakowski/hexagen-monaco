import type { TemplateManifest } from "../../domain/index.js";

export interface TemplateRegistryPort {
  loadAll(): Promise<TemplateManifest[]>;
  loadOne(id: string): Promise<TemplateManifest | null>;
}
