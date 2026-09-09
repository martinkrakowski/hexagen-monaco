import fs from "node:fs/promises";
import path from "node:path";
import type { TemplateConfigStorePort } from "../application/ports/template-config-store.port.js";
import type { TemplateConfig, TemplateConfigState } from "../domain/index.js";
import {
  TEMPLATE_CONFIG_FILE,
  configState,
  emptyConfig,
} from "../domain/index.js";

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

  /**
   * Reads the record without collapsing absence: ENOENT maps to `absent`
   * (unknown), a present file to `empty` or `populated` by its content. A
   * present record that is not readable as a config (a null body, or a
   * missing `templates` map) is a schema fault, raised as its own named
   * error — never as an I/O failure, never as a silent classification.
   */
  async loadState(projectRoot: string): Promise<TemplateConfigState> {
    const configPath = path.join(projectRoot, TEMPLATE_CONFIG_FILE);
    let parsed: unknown;
    try {
      const raw = await fs.readFile(configPath, "utf-8");
      parsed = JSON.parse(raw);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT")
        return { state: "absent" };
      throw new Error(
        `Failed to read template config at ${configPath}: ${(err as Error).message}`,
      );
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      !Object.hasOwn(parsed, "templates")
    ) {
      throw new Error(
        `Template config record at ${configPath} is present but not readable as a config: expected an object with a "templates" map`,
      );
    }
    return configState(parsed as TemplateConfig);
  }

  async save(projectRoot: string, config: TemplateConfig): Promise<void> {
    const configPath = path.join(projectRoot, TEMPLATE_CONFIG_FILE);
    const tmp = `${configPath}.tmp.${Date.now()}`;
    await fs.writeFile(tmp, JSON.stringify(config, null, 2), "utf-8");
    await fs.rename(tmp, configPath);
  }
}
