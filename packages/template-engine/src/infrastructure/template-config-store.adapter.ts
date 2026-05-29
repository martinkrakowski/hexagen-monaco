import fs from "node:fs/promises";
import path from "node:path";
import type { TemplateConfigStorePort } from "../application/ports/template-config-store.port.js";
import type { TemplateConfig } from "../domain/index.js";
import { TEMPLATE_CONFIG_FILE, emptyConfig } from "../domain/index.js";

export class FileSystemTemplateConfigStore implements TemplateConfigStorePort {
  async load(projectRoot: string): Promise<TemplateConfig> {
    const configPath = path.join(projectRoot, TEMPLATE_CONFIG_FILE);
    try {
      const raw = await fs.readFile(configPath, "utf-8");
      return JSON.parse(raw) as TemplateConfig;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT")
        return emptyConfig();
      throw new Error(
        `Failed to read template config at ${configPath}: ${(err as Error).message}`,
      );
    }
  }

  async save(projectRoot: string, config: TemplateConfig): Promise<void> {
    const configPath = path.join(projectRoot, TEMPLATE_CONFIG_FILE);
    const tmp = `${configPath}.tmp.${Date.now()}`;
    await fs.writeFile(tmp, JSON.stringify(config, null, 2), "utf-8");
    await fs.rename(tmp, configPath);
  }
}
