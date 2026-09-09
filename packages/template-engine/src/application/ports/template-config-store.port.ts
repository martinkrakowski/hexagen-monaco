import type {
  TemplateConfig,
  TemplateConfigState,
} from "../../domain/index.js";

export interface TemplateConfigStorePort {
  load(projectRoot: string): Promise<TemplateConfig>;
  save(projectRoot: string, config: TemplateConfig): Promise<void>;
  /**
   * Three-state read (plan F-D7): `absent` — no record, the project's add-on
   * history is unknown; `empty` — present, no add-ons; `populated` — present,
   * with install records. Unlike `load`, this must not collapse `absent` into
   * an empty config. Optional on the port so existing load/save-only stubs
   * keep satisfying the interface; both adapters implement it concretely.
   */
  loadState?(projectRoot: string): Promise<TemplateConfigState>;
}
