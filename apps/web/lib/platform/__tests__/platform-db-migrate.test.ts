import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openPlatformDb } from "../platform-db";

describe("openPlatformDb legacy migration", () => {
  it("opens a pre-owner saved_projects table and rebuilds the composite key", () => {
    const dir = mkdtempSync(join(tmpdir(), "hexagen-platform-db-"));
    const path = join(dir, "platform.db");
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE saved_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        ord INTEGER NOT NULL
      );
      CREATE INDEX idx_saved_projects_ord ON saved_projects (ord);
      CREATE TABLE run_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        project_id TEXT,
        stage INTEGER NOT NULL,
        label TEXT NOT NULL,
        model TEXT,
        refiner_model TEXT,
        duration_ms INTEGER NOT NULL,
        retry_count INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        served_from_cache INTEGER NOT NULL,
        used_llm INTEGER NOT NULL,
        summary TEXT NOT NULL,
        cost_cents INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_run_events_project ON run_events (project_id);
    `);
    legacy
      .prepare(
        `INSERT INTO saved_projects (id, name, payload, created_at, updated_at, ord)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("proj-1", "shop", '{"id":"proj-1"}', 1, 1, 0);
    legacy
      .prepare(
        `INSERT INTO run_events (
           id, run_id, project_id, stage, label, duration_ms, retry_count,
           input_tokens, output_tokens, served_from_cache, used_llm, summary,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("evt-1", "run-1", "proj-1", 0, "start", 10, 0, 1, 1, 0, 1, "ok", 1);
    legacy.close();

    const db = openPlatformDb(path);
    const project = db
      .prepare("SELECT owner_id, name FROM saved_projects WHERE id = ?")
      .get("proj-1") as { owner_id: string; name: string };
    assert.equal(project.owner_id, "");
    assert.equal(project.name, "shop");
    const event = db
      .prepare("SELECT owner_id, run_id FROM run_events WHERE id = ?")
      .get("evt-1") as { owner_id: string; run_id: string };
    assert.equal(event.owner_id, "");
    assert.equal(event.run_id, "run-1");
    const pk = (
      db.pragma("table_info(saved_projects)") as Array<{
        name: string;
        pk: number;
      }>
    )
      .filter((col) => col.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((col) => col.name);
    assert.deepEqual(pk, ["owner_id", "id"]);
    db.close();
  });
});
