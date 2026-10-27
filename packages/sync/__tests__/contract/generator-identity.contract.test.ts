/**
 * Generator identity contract suite (lane H1) — runs the BUILT artifacts the
 * way a consumer does, like the exit-codes suite. Pins that `hexagen manifest
 * migrate` stamps `generator.name` (in the side-car named by `workspace_config`
 * for a split manifest, otherwise at the root), that `hexagen sync` accepts a
 * stamped manifest, and that the whole flow is idempotent and dry-run-clean.
 */
import assert from "node:assert/strict";
import { describe, it, beforeAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import {
  VALID_MANIFEST,
  createPublishedLayoutFixture,
  runHexagen,
  describeResult,
  cleanupFixture,
  assertBuiltArtifactsPresent,
  type ContractFixture,
} from "../helpers/published-layout.js";
import { pathExists } from "../helpers/fs-helpers.js";

const FIXTURE_PREFIX = "hexagen-generator-identity-contract-";

const INDEX_MANIFEST = `version: '2.0'
description: x
workspace_config: workspace.config.yaml
bounded_contexts: []
`;

const SIDE_CAR_NO_GENERATOR = `monorepo:
  packageManager: yarn
`;

const SIDE_CAR_WITH_GENERATOR = `monorepo:
  packageManager: yarn
generator:
  version: 0.2.0
  sync:
    idempotent: true
`;

async function readManifest(
  fix: ContractFixture,
): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(
    path.join(fix.root, ".architecture", "manifest.yaml"),
    "utf8",
  );
  return yaml.load(raw) as Record<string, unknown>;
}

async function readSideCar(
  fix: ContractFixture,
): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(
    path.join(fix.root, ".architecture", "workspace.config.yaml"),
    "utf8",
  );
  return yaml.load(raw) as Record<string, unknown>;
}

describe("generator identity contract — built dist in published layout", () => {
  beforeAll(assertBuiltArtifactsPresent);

  it("stamps a flat legacy manifest: generator.name + schemaVersion, with a backup, idempotently", async () => {
    const fix = await createPublishedLayoutFixture(
      VALID_MANIFEST,
      FIXTURE_PREFIX,
    );
    try {
      const r = await runHexagen(fix, ["manifest", "migrate"]);
      assert.equal(r.code, 0, describeResult(r));

      const manifest = await readManifest(fix);
      assert.equal(
        (manifest.generator as { name?: string } | undefined)?.name,
        "@hexagen-monaco/sync",
      );
      assert.equal(manifest.schemaVersion, 1);

      const backupPath = path.join(
        fix.root,
        ".architecture",
        "manifest.yaml.pre-migrate-backup",
      );
      assert.equal(await pathExists(backupPath), true);

      const afterFirst = await fs.readFile(
        path.join(fix.root, ".architecture", "manifest.yaml"),
        "utf8",
      );
      const second = await runHexagen(fix, ["manifest", "migrate"]);
      assert.equal(second.code, 0, describeResult(second));
      assert.ok(second.stdout.includes("nothing to do"), describeResult(second));
      const afterSecond = await fs.readFile(
        path.join(fix.root, ".architecture", "manifest.yaml"),
        "utf8",
      );
      assert.equal(afterSecond, afterFirst);
    } finally {
      await cleanupFixture(fix.root);
    }
  });

  it("adds generator.name to a split manifest's side-car (no generator present)", async () => {
    const fix = await createPublishedLayoutFixture(
      VALID_MANIFEST,
      FIXTURE_PREFIX,
    );
    try {
      await fs.writeFile(
        path.join(fix.root, ".architecture", "manifest.yaml"),
        INDEX_MANIFEST,
        "utf8",
      );
      await fs.writeFile(
        path.join(fix.root, ".architecture", "workspace.config.yaml"),
        SIDE_CAR_NO_GENERATOR,
        "utf8",
      );

      const r = await runHexagen(fix, ["manifest", "migrate"]);
      assert.equal(r.code, 0, describeResult(r));

      assert.deepEqual(await readSideCar(fix), {
        monorepo: { packageManager: "yarn" },
        generator: { name: "@hexagen-monaco/sync" },
      });
      const manifest = await readManifest(fix);
      assert.equal(manifest.generator, undefined);
    } finally {
      await cleanupFixture(fix.root);
    }
  });

  it("keeps an existing side-car generator block and only adds the name", async () => {
    const fix = await createPublishedLayoutFixture(
      VALID_MANIFEST,
      FIXTURE_PREFIX,
    );
    try {
      await fs.writeFile(
        path.join(fix.root, ".architecture", "manifest.yaml"),
        INDEX_MANIFEST,
        "utf8",
      );
      await fs.writeFile(
        path.join(fix.root, ".architecture", "workspace.config.yaml"),
        SIDE_CAR_WITH_GENERATOR,
        "utf8",
      );

      const r = await runHexagen(fix, ["manifest", "migrate"]);
      assert.equal(r.code, 0, describeResult(r));

      assert.deepEqual(await readSideCar(fix), {
        monorepo: { packageManager: "yarn" },
        generator: {
          name: "@hexagen-monaco/sync",
          version: "0.2.0",
          sync: { idempotent: true },
        },
      });
    } finally {
      await cleanupFixture(fix.root);
    }
  });

  it("--dry-run reports the rewrite and writes nothing", async () => {
    const fix = await createPublishedLayoutFixture(
      VALID_MANIFEST,
      FIXTURE_PREFIX,
    );
    try {
      await fs.writeFile(
        path.join(fix.root, ".architecture", "manifest.yaml"),
        INDEX_MANIFEST,
        "utf8",
      );
      await fs.writeFile(
        path.join(fix.root, ".architecture", "workspace.config.yaml"),
        SIDE_CAR_NO_GENERATOR,
        "utf8",
      );
      const beforeManifest = await fs.readFile(
        path.join(fix.root, ".architecture", "manifest.yaml"),
        "utf8",
      );
      const beforeSideCar = await fs.readFile(
        path.join(fix.root, ".architecture", "workspace.config.yaml"),
        "utf8",
      );

      const r = await runHexagen(fix, ["manifest", "migrate", "--dry-run"]);
      assert.equal(r.code, 0, describeResult(r));
      assert.ok(r.stdout.includes("Would rewrite"), describeResult(r));

      const afterManifest = await fs.readFile(
        path.join(fix.root, ".architecture", "manifest.yaml"),
        "utf8",
      );
      const afterSideCar = await fs.readFile(
        path.join(fix.root, ".architecture", "workspace.config.yaml"),
        "utf8",
      );
      assert.equal(afterManifest, beforeManifest);
      assert.equal(afterSideCar, beforeSideCar);
      assert.equal(
        await pathExists(
          path.join(
            fix.root,
            ".architecture",
            "workspace.config.yaml.pre-migrate-backup",
          ),
        ),
        false,
      );
    } finally {
      await cleanupFixture(fix.root);
    }
  });

  it("a stamped manifest still loads through sync --dry-run", async () => {
    const stamped = `${VALID_MANIFEST}generator:
  name: "@hexagen-monaco/sync"
`;
    const fix = await createPublishedLayoutFixture(stamped, FIXTURE_PREFIX);
    try {
      const r = await runHexagen(fix, ["sync", "--dry-run", "--allow-dirty"]);
      assert.equal(r.code, 0, describeResult(r));
    } finally {
      await cleanupFixture(fix.root);
    }
  });
});
