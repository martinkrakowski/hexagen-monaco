import { InMemoryAddOnMaterializer } from "./in-memory-add-on-materializer.js";
import type { TemplateFileLoader } from "./in-memory-file-emitter.adapter.js";
import type { TemplateRegistryPort } from "../application/ports/template-registry.port.js";
import {
  TEMPLATE_MANIFESTS,
  TEMPLATE_FILES,
} from "./generated/template-bundle.generated.js";

/**
 * The serverless-safe entry point for the web generation path: an
 * InMemoryAddOnMaterializer backed by the generated template bundle (manifests
 * + file contents compiled into the module), so it needs **no runtime
 * filesystem access**. Stateless — safe to construct once and reuse across
 * requests (a fresh emitter/config/question-engine is created per materialize()).
 */
export function createInMemoryMaterializer(): InMemoryAddOnMaterializer {
  const registry: TemplateRegistryPort = {
    loadAll: async () => TEMPLATE_MANIFESTS,
    loadOne: async (id) => TEMPLATE_MANIFESTS.find((m) => m.id === id) ?? null,
  };
  const loadFile: TemplateFileLoader = async (templateId, relPath) =>
    TEMPLATE_FILES[`${templateId}/${relPath}`] ?? null;

  return new InMemoryAddOnMaterializer(registry, loadFile);
}
