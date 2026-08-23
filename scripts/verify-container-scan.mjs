#!/usr/bin/env node
/**
 * Helpers for the in-container standalone smoke (lint.yml `container-smoke`,
 * enforcement plan P3.3 / decision D-3).
 *
 * The ubuntu `standalone-smoke` job runs the packaged artifact on setup-node
 * and can never see what only the IMAGE decides: the runner stage's symlink
 * shim under /app/node_modules/@hexagen, musl vs glibc, the non-root `nextjs`
 * user, HEXAGEN_SCAN_WORKSPACE_DIR, and the Node major actually baked into
 * node:20-alpine (#616 shipped a Node-22-only artifact past a Node-22 runner).
 * The workflow drives docker; this script owns the three pieces that are not
 * one-line shell:
 *
 *   --make-fixture <dir>   write the throwaway project the scan runs against
 *                          (same shape as verify-standalone-scan.mjs)
 *   --wait <url>           poll until the app answers with ANY status < 500 —
 *                          the deploy healthcheck's exact liveness contract
 *                          (deploy/docker-compose.prod.yml): up-and-routing,
 *                          not necessarily configured
 *   --assert <file>        read captured scan stdout, take the LAST JSON line
 *                          (the envelope contract from #577), and require the
 *                          D-P1 shape: findings.collected === true AND
 *                          filesScanned >= 1. A scan that "succeeds" while
 *                          collecting nothing is the false-green this job
 *                          exists to catch, so it fails loudly here.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const [, , mode, arg] = process.argv;

function fail(message) {
  console.error(`FAILED — ${message}`);
  process.exit(1);
}

function makeFixture(dir) {
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "smoke-target", version: "1.0.0", private: true }),
  );
  writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
      },
      include: ["src/**/*.ts"],
    }),
  );
  writeFileSync(path.join(dir, "src/index.ts"), "export const a = 1;\n");
  console.log(`fixture written to ${dir}`);
}

function probeOnce(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode ?? 599);
    });
    req.on("error", () => resolve(599));
    req.setTimeout(4000, () => {
      req.destroy();
      resolve(599);
    });
  });
}

async function waitHealthy(url) {
  const deadlineMs = Date.now() + 90_000;
  for (;;) {
    const status = await probeOnce(url);
    if (status < 500) {
      console.log(`up — ${url} answered ${status}`);
      return;
    }
    if (Date.now() > deadlineMs) {
      fail(`${url} did not answer below 500 within 90s (last: ${status})`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

function assertEnvelope(file) {
  const stdout = readFileSync(file, "utf8");
  const line = stdout
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .pop();
  if (line === undefined) {
    fail(`no JSON envelope in captured scan output:\n${stdout.slice(-2000)}`);
  }
  const envelope = JSON.parse(line);
  const findings = envelope.findings ?? {};
  console.log(`  filesScanned  : ${envelope.filesScanned}`);
  console.log(`  collected     : ${findings.collected}`);
  console.log(`  failureReason : ${findings.failureReason ?? "none"}`);
  if (findings.collected !== true) {
    fail(
      `the in-container scan ran but collected no findings ` +
        `(${findings.failureReason ?? "no reason given"}).`,
    );
  }
  if (
    !(typeof envelope.filesScanned === "number" && envelope.filesScanned >= 1)
  ) {
    fail(
      `filesScanned is ${envelope.filesScanned} — a scan over zero files is ` +
        `not a pass (the D-P1 contract requires >= 1).`,
    );
  }
  console.log("PASSED — the production image scans and collects findings.");
}

if (mode === "--make-fixture" && arg) makeFixture(arg);
else if (mode === "--wait" && arg) await waitHealthy(arg);
else if (mode === "--assert" && arg) assertEnvelope(arg);
else {
  console.error(
    "usage: verify-container-scan.mjs --make-fixture <dir> | --wait <url> | --assert <file>",
  );
  process.exit(1);
}
