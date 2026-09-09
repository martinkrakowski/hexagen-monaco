import type { TemplateConfigStorePort } from "../application/ports/template-config-store.port.js";
import type { TemplateConfig, TemplateConfigState } from "../domain/index.js";
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
    // Deliberately differs from loadState(): load answers "give me a config
    // to run with", so a run with no project on disk gets a fresh empty
    // config; loadState answers "what does the durable record say" and
    // reports absent. Do not port a call site between them expecting the
    // same absence semantics.
    return emptyConfig();
  }

  /**
   * There is no durable record in the in-memory flow — `save` persists
   * nothing, so nothing was ever installed through a record. That is
   * `absent` (add-on history unknown), never `empty` (known to have none).
   */
  async loadState(): Promise<TemplateConfigState> {
    return { state: "absent" };
  }

  async save(): Promise<void> {
    // Nothing is persisted in the in-memory flow.
  }
}
