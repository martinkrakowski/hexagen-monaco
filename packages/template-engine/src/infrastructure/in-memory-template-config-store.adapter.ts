import type { TemplateConfigStorePort } from "../application/ports/template-config-store.port.js";
import type { TemplateConfig } from "../domain/index.js";
import { emptyConfig } from "../domain/index.js";

/**
 * A TemplateConfigStorePort that holds config only in memory — for a one-shot
 * in-memory generation run with no project on disk. `load` returns a fresh empty
 * config (AddTemplateUseCase mutates it in place as templates apply, so
 * `type:"auto"` cross-template derivation still works within the run); `save` is
 * a no-op.
 */
export class InMemoryTemplateConfigStore implements TemplateConfigStorePort {
  async load(): Promise<TemplateConfig> {
    return emptyConfig();
  }

  async save(): Promise<void> {
    // Nothing is persisted in the in-memory flow.
  }
}
