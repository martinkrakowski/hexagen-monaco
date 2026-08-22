// apps/web/next.config.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Monorepo root is two levels up from apps/web
const monorepoRoot = path.resolve(__dirname, "../..");

// Read version from root package.json
const pkg = JSON.parse(
  readFileSync(path.join(monorepoRoot, "package.json"), "utf-8"),
);

// Capture git commit hash at build time (graceful fallback for environments
// where git may not be available, e.g. certain Docker build stages)
let gitHash = "dev";
try {
  gitHash = execSync("git rev-parse --short HEAD", {
    cwd: monorepoRoot,
    timeout: 5000,
  })
    .toString()
    .trim();
} catch {
  // git unavailable — leave as 'dev'
}

// ---------------------------------------------------------------------------
// Ship the `hexagen` CLI inside the standalone output (D-P1).
//
// Three route handlers -- /api/projects/scan, /api/projects/scan/github and
// /api/projects/bootstrap -- run `hexagen scan` as a SUBPROCESS via execFile.
// Next's file tracer follows import/require graphs, and nothing imports
// dist/cli.js, so the tracer has no reason to keep it. `@hexagen/sync` is also
// in transpilePackages, which inlines its LIBRARY exports into chunks -- that
// is why portName and the wire-adapters work in production while the CLI does
// not. The runtime image copies only .next/standalone and never runs an
// install, so resolveHexagenBin finds nothing and every scan degrades to
// `scan_could_not_run`.
//
// The closure below is COMPUTED, not hand-listed. tsup bundles the workspace
// @hexagen/* deps into cli.js but leaves third-party ones external, so the
// binary needs commander, js-yaml, ts-morph and zod present on disk -- plus
// their transitive deps, which today reach 15 packages through ts-morph
// (@ts-morph/common -> tinyglobby -> fdir, picomatch, ...). Freezing that list
// in config would rot silently the next time ts-morph bumps a dependency, and
// the failure mode is a CLI that crashes on require in production only.
// Deriving it from packages/sync/package.json means adding a dependency there
// is enough; nothing here needs editing.
// Two binaries, not one. `hexagen scan` shells out to `hexagen-lint` for the
// actual architecture check, so shipping only the sync CLI produces a scan that
// runs, writes layout.yaml and a report, and reports
// `findings.collected: false` with "hexagen-lint binary was not found" -- a
// scan that never checks anything. Verified by running the built CLI out of a
// standalone tree.
const cliPackages = ["packages/sync", "tools/arch-linter"];

/**
 * Locate a package the way Node does: walk `node_modules` up from the requester.
 *
 * Reading only `<root>/node_modules/<name>` assumed every dependency is hoisted
 * to the top. Yarn does hoist by default, but it nests on a version conflict --
 * and a nested dependency read that way is not "absent", it is present at a
 * path the lookup never checked. Returns the containing directory relative to
 * the monorepo root, or null when the package is genuinely not installed.
 */
function locatePackage(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) {
      return path.relative(monorepoRoot, candidate).split(path.sep).join("/");
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Every package the CLIs need at runtime, as monorepo-relative directories.
 *
 * An unresolvable entry THROWS rather than being skipped. The previous revision
 * swallowed the read error and continued, so a dependency that was declared but
 * not found simply vanished from the trace: the build stayed green and the CLI
 * crashed on require inside the container, which is the most expensive place to
 * diagnose it. These names come from the `dependencies` of packages this repo
 * builds, so an unresolvable one means the install is broken, and a broken
 * install should be loud. `optionalDependencies` are deliberately not walked --
 * those are the ones allowed to be absent.
 */
function runtimeClosure(seeds, fromDir) {
  const found = new Map();
  const missing = [];
  const queue = seeds.map((name) => ({ name, from: fromDir }));
  while (queue.length > 0) {
    const { name, from } = queue.shift();
    if (found.has(name)) continue;
    const dir = locatePackage(name, from);
    if (dir === null) {
      const by = path.relative(monorepoRoot, from) || ".";
      missing.push(`${name} (required by ${by})`);
      continue;
    }
    found.set(name, dir);
    const manifest = JSON.parse(
      readFileSync(path.join(monorepoRoot, dir, "package.json"), "utf-8"),
    );
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      queue.push({ name: dep, from: path.join(monorepoRoot, dir) });
    }
  }
  if (missing.length > 0) {
    throw new Error(
      "next.config.mjs: cannot trace the hexagen CLI runtime closure. " +
        `${missing.length} dependency/ies could not be resolved:\n  ` +
        missing.join("\n  ") +
        "\nThe standalone build would ship a CLI that crashes on require.",
    );
  }
  return [...found.values()].sort();
}

// @hexagen/* are bundled INTO cli.js by tsup, so they are deliberately not
// seeds -- including them would copy megabytes of already-inlined code.
//
// NOTE the `../../` on every entry. These globs are resolved with `cwd` set to
// the NEXT APP DIRECTORY (apps/web), not to `outputFileTracingRoot` --
// collect-build-traces.js globs with `cwd: dir` and only then joins the result
// against the app dir. Monorepo-root-relative globs therefore match zero files
// and are silently dropped: the build stays green and the binary is simply
// absent, which is indistinguishable from this config not existing at all.
// Verified empirically -- root-relative globs produced a standalone output
// with no cli.js in it.
const fromWebToRoot = path
  .relative(__dirname, monorepoRoot)
  .split(path.sep)
  .join("/");
const atRoot = (glob) => `${fromWebToRoot}/${glob}`;

const cliSeeds = new Set();
const cliPackageGlobs = [];
for (const pkgDir of cliPackages) {
  const manifest = JSON.parse(
    readFileSync(path.join(monorepoRoot, pkgDir, "package.json"), "utf-8"),
  );
  // The manifest as well as the bundle: both resolvers read `bin.<name>` out of
  // the package.json to locate the entry, so tracing only dist/** would ship
  // the binary and still resolve to null.
  cliPackageGlobs.push(atRoot(`${pkgDir}/package.json`));
  cliPackageGlobs.push(atRoot(`${pkgDir}/dist/**/*`));
  for (const dep of Object.keys(manifest.dependencies ?? {})) {
    // @hexagen/* are bundled INTO the CLI bundles by tsup, so they are
    // deliberately not seeds -- including them would copy megabytes of
    // already-inlined code.
    if (!dep.startsWith("@hexagen/")) cliSeeds.add(dep);
  }
}

// runtimeClosure returns DIRECTORIES (e.g. "node_modules/zod", or a nested
// "packages/sync/node_modules/zod"), not bare names, so a nested install is
// traced from where it actually lives rather than from where it was assumed.
const closureDirs = runtimeClosure([...cliSeeds], monorepoRoot);

const hexagenCliFiles = [
  ...cliPackageGlobs,
  ...closureDirs.map((dir) => atRoot(`${dir}/**/*`)),
];

// Deny-list, deliberately NOT an allow-list of runtime extensions.
//
// Trimming these saves ~3.3 MB of an ~18.5 MB closure. An allow-list of
// "extensions Node can load" would save marginally more and risks dropping a
// file type some package genuinely reads at runtime (.wasm, a data file, a
// binary) -- and that failure is a production-only crash, exactly the class the
// throw above exists to prevent. These three are safe because Node cannot
// execute any of them: type declarations, source maps and prose.
const nonRuntimeExcludes = closureDirs.flatMap((dir) => [
  atRoot(`${dir}/**/*.d.ts`),
  atRoot(`${dir}/**/*.map`),
  atRoot(`${dir}/**/*.md`),
]);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,

  // Allow LAN IP access in dev (Next.js 15+ host validation)
  // Use wildcard for flexibility during development
  allowedDevOrigins: ["10.10.0.219", "localhost", "127.0.0.1"],

  // Workspace packages to transpile
  transpilePackages: [
    "@hexagen/agentic-interaction",
    "@hexagen/ai-pipeline",
    "@hexagen/byok",
    "@hexagen/core-domain",
    "@hexagen/eslint-plugin-ui",
    "@hexagen/governance",
    "@hexagen/local-llm",
    "@hexagen/messaging",
    "@hexagen/monaco-orchestration",
    "@hexagen/project-configuration",
    "@hexagen/project-generation",
    "@hexagen/prompt-compiler",
    "@hexagen/reconciliation-engine",
    "@hexagen/shared",
    "@hexagen/sync",
    "@hexagen/transaction-system",
    "@hexagen/ui",
    "@hexagen/ui-projection-compiler",
    "@hexagen/visualization",
    "@hexagen/web-driver",
    "@hexagen/wizard-orchestration",
  ],

  // Ensure proper build output handling for monorepo environments
  distDir: ".next",

  // Required for monorepo deployments - tells Next.js where to trace dependencies from
  outputFileTracingRoot: monorepoRoot,

  // Keyed per route rather than globbed, so the list doubles as the record of
  // which handlers actually spawn the binary. A route added later that spawns
  // it and is not listed here fails in the image and nowhere else.
  outputFileTracingIncludes: {
    "/api/projects/scan": hexagenCliFiles,
    "/api/projects/scan/github": hexagenCliFiles,
    "/api/projects/bootstrap": hexagenCliFiles,
  },

  outputFileTracingExcludes: {
    "/api/projects/scan": nonRuntimeExcludes,
    "/api/projects/scan/github": nonRuntimeExcludes,
    "/api/projects/bootstrap": nonRuntimeExcludes,
  },

  experimental: {
    // Allow importing from directories outside of the app (monorepo packages)
    externalDir: true,
  },

  // Injected at build time for observability (not runtime-configured secrets)
  env: {
    APP_VERSION: pkg.version,
    COMMIT_HASH: gitHash,
  },

  // Webpack configuration for monorepo package resolution
  webpack: (config) => {
    config.resolve.modules = [
      path.resolve(monorepoRoot, "node_modules"),
      "node_modules",
      ...(config.resolve.modules || []),
    ];

    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };

    config.resolve.conditionNames = [
      "source",
      ...(config.resolve.conditionNames || []),
    ];

    return config;
  },

  turbopack: {
    root: monorepoRoot,
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },

  typescript: { ignoreBuildErrors: true },

  redirects: async () => [
    {
      source: "/",
      destination: "/projects/new",
      permanent: true,
    },
  ],
};

export default nextConfig;
