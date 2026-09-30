#!/usr/bin/env node
/**
 * `hexagen-orchestration-init` — the bin.
 *
 * All the behaviour is in `../init/init.ts` (`initProject`); this is the thin
 * edge supplying the real filesystem.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  isFile,
  isOccupiedByNonFile,
  nonDirectoryAncestor,
} from "../internal/fs-probe.js";
import { loadConfigFor } from "../internal/project.js";
import { TEMPLATE_CONFIG_PATH, initProject } from "../init/init.js";

const loaded = await loadConfigFor();
const at = (path: string): string => `${loaded.root}/${path}`;

const { code, lines } = await initProject(loaded, {
  exists: (path) => isFile(at(path)),
  occupied: (path) => isOccupiedByNonFile(at(path)),
  blockedAncestor: (path) => nonDirectoryAncestor(loaded.root, path),
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

for (const line of lines) (code === 0 ? console.log : console.error)(line);
process.exitCode = code;
