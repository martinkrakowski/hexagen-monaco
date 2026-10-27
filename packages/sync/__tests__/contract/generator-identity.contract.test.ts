/**
 * Generator identity contract suite (lane H1) — runs the BUILT artifacts the
 * way a consumer does, like the exit-codes suite. Pins that `hexagen manifest
 * migrate` stamps `generator.name` (in the side-car named by `workspace_config`
 * for a split manifest, otherwise at the root), that `hexagen sync` accepts a
 * stamped manifest, and that the whole flow is idempotent and dry-run-clean.
 */
import assert from "node:assert/strict";
import { describe, it, beforeAll, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
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

const OUTSIDE_PREFIX = "hexagen-generator-identity-outside-";

/**
 * Temp directories created OUTSIDE a fixture by the symlink refusal tests
 * below — removed in afterEach so a failing assertion cannot orphan them.
 */
const outsideDirs: string[] = [];

const INDEX_MANIFEST = `version: '2.0'
description: x
workspace_config: workspace.config.yaml
bounded_contexts: []
`;

const INDEX_MANIFEST_EXTERNAL_POINTER = `version: '2.0'
description: x
workspace_config: external/workspace.config.yaml
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

  afterEach(async () => {
    const dirs = outsideDirs.splice(0, outsideDirs.length);
    await Promise.all(
      dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

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
      assert.ok(
        second.stdout.includes("nothing to do"),
        describeResult(second),
      );
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

  it("refuses a side-car behind a symlinked directory inside .architecture/ (H1 review)", async () => {
    const fix = await createPublishedLayoutFixture(
      VALID_MANIFEST,
      FIXTURE_PREFIX,
    );
    try {
      const outsideDir = await fs.mkdtemp(
        path.join(os.tmpdir(), OUTSIDE_PREFIX),
      );
      outsideDirs.push(outsideDir);
      const outsideFile = path.join(outsideDir, "workspace.config.yaml");
      await fs.writeFile(outsideFile, SIDE_CAR_NO_GENERATOR, "utf8");
      await fs.symlink(
        outsideDir,
        path.join(fix.root, ".architecture", "external"),
        "dir",
      );
      await fs.writeFile(
        path.join(fix.root, ".architecture", "manifest.yaml"),
        INDEX_MANIFEST_EXTERNAL_POINTER,
        "utf8",
      );

      const beforeOutside = await fs.readFile(outsideFile, "utf8");
      const r = await runHexagen(fix, ["manifest", "migrate"]);
      assert.notEqual(r.code, 0, describeResult(r));
      assert.ok(r.stderr.includes("Migration failed"), describeResult(r));
      assert.ok(
        r.stderr.includes("external/workspace.config.yaml"),
        describeResult(r),
      );
      assert.equal(await fs.readFile(outsideFile, "utf8"), beforeOutside);
      assert.equal(
        await pathExists(outsideFile + ".pre-migrate-backup"),
        false,
      );
    } finally {
      await cleanupFixture(fix.root);
    }
  });

  it("refuses a side-car that is itself a symlink to a file outside .architecture/ (H1 review)", async () => {
    const fix = await createPublishedLayoutFixture(
      VALID_MANIFEST,
      FIXTURE_PREFIX,
    );
    try {
      const outsideDir = await fs.mkdtemp(
        path.join(os.tmpdir(), OUTSIDE_PREFIX),
      );
      outsideDirs.push(outsideDir);
      const outsideFile = path.join(outsideDir, "workspace.config.yaml");
      await fs.writeFile(outsideFile, SIDE_CAR_NO_GENERATOR, "utf8");
      await fs.symlink(
        outsideFile,
        path.join(fix.root, ".architecture", "workspace.config.yaml"),
        "file",
      );
      await fs.writeFile(
        path.join(fix.root, ".architecture", "manifest.yaml"),
        INDEX_MANIFEST,
        "utf8",
      );

      const beforeOutside = await fs.readFile(outsideFile, "utf8");
      const r = await runHexagen(fix, ["manifest", "migrate"]);
      assert.notEqual(r.code, 0, describeResult(r));
      assert.ok(r.stderr.includes("Migration failed"), describeResult(r));
      assert.ok(r.stderr.includes("workspace.config.yaml"), describeResult(r));
      assert.equal(await fs.readFile(outsideFile, "utf8"), beforeOutside);
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
