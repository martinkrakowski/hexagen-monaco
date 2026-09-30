#!/usr/bin/env node
/**
 * `hexagen-orchestration-init` — the bin.
 *
 * All the behaviour is in `../init/init.ts`; this is the thin edge supplying the
 * real filesystem.
 */
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname } from "node:path";
import { loadConfigFor } from "../internal/project.js";
import {
  OVERLAY_DIR,
  TEMPLATE_CONFIG_PATH,
  formatReport,
  runInit,
} from "../init/init.js";

const { root, config } = await loadConfigFor();
const at = (path: string): string => `${root}/${path}`;

const { outcomes } = await runInit(config, {
  exists: async (path) => {
    try {
      await access(at(path));
      return true;
    } catch {
      return false;
    }
  },
  write: async (path, contents) => {
    const full = at(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, contents, "utf8");
  },
  readTemplateConfig: async () => {
    try {
      return await readFile(at(TEMPLATE_CONFIG_PATH), "utf8");
    } catch {
      return undefined;
    }
  },
});

console.log(formatReport(outcomes));
if (outcomes.some((o) => o.action === "created")) {
  console.log(
    `init: run \`hexagen-orchestration-doctor\` next to check the overlay.`,
  );
} else {
  console.log(
    `init: ${OVERLAY_DIR}/ is already complete; nothing was changed.`,
  );
}
