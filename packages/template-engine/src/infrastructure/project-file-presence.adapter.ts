import fs from "node:fs/promises";
import path from "node:path";
import type { ProjectFilePresencePort } from "../application/ports/project-file-presence.port.js";

/**
 * `ProjectFilePresencePort` over the real filesystem.
 *
 * The join lives here rather than in the use case: turning a project-relative
 * output path into something the host can stat is filesystem capability, not
 * validation policy (ADR-0047 §4, and the `node-builtin-in-layer` ban on
 * `node:path` in application/domain).
 *
 * No in-memory sibling ships here: the headless materialization path
 * (`InMemoryFileEmitter`) does not run validation today, and an unused adapter
 * would be exactly the dead-copy weight ADR-0047 §1 removed. The port's
 * implementability by a non-filesystem backend is exercised by the doubles in
 * `__tests__/application/validate-templates-ports.test.ts`.
 */
export class FileSystemProjectFilePresence implements ProjectFilePresencePort {
  async exists(projectRoot: string, relativePath: string): Promise<boolean> {
    try {
      await fs.access(path.join(projectRoot, relativePath));
      return true;
    } catch {
      // Any failure to reach the path — absent, or unreadable — answers "no".
      // This mirrors the pre-port behaviour, where a bare `fs.access` rejection
      // was recorded as a missing file without inspecting `errno`.
      return false;
    }
  }
}
