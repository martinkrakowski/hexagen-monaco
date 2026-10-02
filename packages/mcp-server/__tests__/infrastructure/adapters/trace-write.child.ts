// Child process for the mixed-format race test. argv: root, role, count.
// role "writer" appends `count` lines; role "flipper" toggles the manifest.
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { TraceWriteAdapter } from "../../../src/infrastructure/adapters/trace-write.adapter.js";

const [root, role, countText] = process.argv.slice(2) as [
  string,
  string,
  string,
];
const count = Number(countText);
const manifest = path.join(root, ".architecture", "manifest.yaml");

if (role === "flipper") {
  await mkdir(path.dirname(manifest), { recursive: true });
  for (let i = 0; i < count; i++) {
    await writeFile(manifest, "x: 1\n");
    await new Promise((r) => setTimeout(r, 1));
    await rm(manifest, { force: true });
    await new Promise((r) => setTimeout(r, 1));
  }
} else {
  const adapter = new TraceWriteAdapter(root);
  for (let i = 0; i < count; i++) {
    const r = await adapter.appendLine({
      grant_id: "g",
      goal_id: role,
      tool_call: {
        name: "t",
        args: { i },
        result: {},
        time: "2026-10-01T10:00:00.000Z",
      },
      halt_reason: "completed",
      transaction_ids: ["tx"],
      started_at: "2026-10-01T10:00:00.000Z",
      ended_at: "2026-10-01T10:00:00.000Z",
    });
    if (!r.success) {
      console.error(r.error.message);
      process.exit(3);
    }
  }
}
