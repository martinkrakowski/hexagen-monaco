# ---------- 1️⃣  Build stage ----------
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS base

# Enable corepack and set Yarn version
RUN corepack enable && corepack prepare yarn@4.12.0 --activate

# ---------- manifests: only what `yarn install` reads ----------
# This stage is rebuilt on every source change, but its OUTPUT (/manifests) only
# changes when a manifest, the lockfile or a workspace's committed bin/ folder
# changes, and BuildKit caches the builder's COPY --from=manifests by content, so
# the install layer below is reused. The three groups are the root package.json's
# `workspaces` (apps/*, packages/*, tools/*) — a new group must be added here.
# A workspace's committed bin/ folder is copied so that a `bin` entry pointing
# at a committed file exists at install time, as it did when the whole tree was
# copied first (today no dependent links one: yarn drops a bin whose target is
# missing without an error). The `test -f` lines fail the build if the loop
# collected nothing.
FROM base AS manifests
WORKDIR /src
COPY . .
RUN mkdir -p /manifests \
    && cp package.json yarn.lock /manifests/ \
    && for group in apps packages tools; do \
         for manifest in "$group"/*/package.json; do \
           [ -f "$manifest" ] || continue; \
           workspace="$(dirname "$manifest")"; \
           mkdir -p "/manifests/$workspace" \
           && cp "$manifest" "/manifests/$manifest" || exit 1; \
           if [ -d "$workspace/bin" ]; then cp -R "$workspace/bin" "/manifests/$workspace/bin" || exit 1; fi; \
         done; \
       done \
    && test -f /manifests/apps/web/package.json \
    && test -f /manifests/packages/sync/package.json \
    && test -f /manifests/tools/arch-linter/package.json

FROM base AS builder
WORKDIR /app

# better-sqlite3 (the free-tier quota store) has no Alpine/musl prebuilt binary,
# so it compiles from source during `yarn install` — which needs python3 + a C++
# toolchain that node:alpine doesn't ship. (esbuild/sharp/etc. use prebuilds,
# which is why only better-sqlite3 failed without this.) Its own layer so it
# caches independently of source changes.
RUN apk add --no-cache python3 make g++

# Copy the manifests only (cached by content) and install from them. The install
# runs with the SAME replaced .yarnrc.yml as before. Yarn 4 runs only
# preinstall, install and postinstall for a workspace: the root `prepare`
# script (husky) never ran in this install, before or after this change, so
# the missing .git and .husky make no difference.
COPY --from=manifests /manifests/ ./
RUN echo 'nodeLinker: node-modules' > .yarnrc.yml && yarn install

# Copy the sources AND the repository's own .yarnrc.yml, so the replacement is
# repeated — the build below has always run with the replaced file. node_modules
# is kept out of the context by .dockerignore, otherwise a developer's local
# node_modules would overwrite the installed one here.
COPY . .
RUN echo 'nodeLinker: node-modules' > .yarnrc.yml

# Declare ARG variables for build-time injection
ARG NEXT_PUBLIC_LLM_AVAILABLE
ARG NEXT_PUBLIC_LLM_MODEL
ARG NEXT_PUBLIC_FREE_TIER_MODEL

# Re-export them as ENV variables so Next.js can inline them during turbo build
ENV NEXT_PUBLIC_LLM_AVAILABLE=$NEXT_PUBLIC_LLM_AVAILABLE
ENV NEXT_PUBLIC_LLM_MODEL=$NEXT_PUBLIC_LLM_MODEL
ENV NEXT_PUBLIC_FREE_TIER_MODEL=$NEXT_PUBLIC_FREE_TIER_MODEL

# Hard cap Node.js memory to 4GB to leave 3GB for Docker/Ubuntu OS
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV NEXT_TELEMETRY_DISABLED=1

# Build only the web app and its dependencies, one at a time (memory optimization)
RUN yarn turbo build --filter=web... --concurrency=1

# Post-build safety: fail if a raw OpenAI/Anthropic-shaped key is embedded in JS chunks.
# Uses find+grep instead of grep --include because BusyBox grep (Alpine) does not support
# --include. Scanning only *.js avoids false positives from CSS (e.g. react-flow's
# "mask-stroke-color-default" contains the substring "sk-stroke-color-default").
RUN cd apps/web && \
    LEAKS=$(find .next/static -name '*.js' \
        -exec grep -lE 'sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}' {} + \
        2>/dev/null); \
    if [ -n "$LEAKS" ]; then \
      echo "FATAL: API key value leak detected in client bundle" && \
      echo "$LEAKS" && exit 1; \
    fi

# ---------- 2️⃣  Runtime stage ----------
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runner
WORKDIR /app

# Enable corepack for Yarn 4
RUN corepack enable && corepack prepare yarn@4.12.0 --activate
# The runtime runs `node apps/web/server.js` only. npm (and the tar it bundles, CVE-2026-59873)
# is never called here, so it does not ship.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
 && ! command -v npm && ! command -v npx

# Only need production deps + the built output
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Copy the entire standalone directory to preserve monorepo structure
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./

# Copy static assets to the mirrored path
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

# Mount point for the free-tier quota SQLite DB (a persistent volume in the
# k3s Deployment). Pre-create + own it as root so the volume
# initialises writable for the non-root runtime user.
RUN mkdir -p /data && chown nextjs:nodejs /data

# ---------- `hexagen scan` must be able to FIND `hexagen-lint` ----------
#
# `hexagen scan` does not check anything itself: it shells out to a second
# binary. @hexagen/sync's resolveArchLinterBin locates that binary ONLY by
# walking UP from the directory being scanned, checking
# `node_modules/.bin/hexagen-lint` and then
# `node_modules/@hexagen{,-monaco}/arch-linter` at each level. There is no PATH
# fallback and no env override — the walk is the entire contract, and it is in a
# published package, so it is not ours to change here.
#
# #615 put the FILES in the image; two further things have to be true for that
# walk to reach them, and neither was:
#
#  1. The linter must be reachable through a `node_modules` path. Next's tracer
#     copies files, not Yarn's workspace symlinks, so the standalone output
#     contains `tools/arch-linter/dist/cli.js` and NO `node_modules/.bin` and NO
#     `node_modules/@hexagen` directory at all (verified by listing a built
#     standalone tree). Recreating the workspace link is what gives the resolver
#     a shape it recognises. Deliberately the PACKAGE link and not a `.bin`
#     shim: resolving through the package yields a `.js` path, which
#     packages/sync launches through the current interpreter, so nothing depends
#     on the traced copy having kept its executable bit.
#  2. Scan workspaces must live where walking up reaches /app — see
#     HEXAGEN_SCAN_WORKSPACE_DIR below.
#
# The `test -f` lines are the gate: if a future trace change drops the linter,
# the BUILD fails here instead of every production scan silently returning
# `findings.collected: false`.
RUN mkdir -p /app/node_modules/@hexagen \
    && ln -sfn ../../tools/arch-linter /app/node_modules/@hexagen/arch-linter \
    && test -f /app/node_modules/@hexagen/arch-linter/package.json \
    && test -f /app/node_modules/@hexagen/arch-linter/dist/cli.js \
    && test -f /app/packages/sync/dist/cli.js \
    && test -f /app/package.json \
    && node -e "process.exit(require('/app/package.json').workspaces===undefined?1:0)"

# The last two lines gate the INSTALLATION ANCHOR, not just the binaries.
# resolveInstallationRoot walks up for a package.json declaring `workspaces`;
# if a future COPY or trace change drops it, findAppRoot returns null, the
# resolver falls back to cwd, resolveHexagenBin returns null, and every scan
# reports scan_could_not_run while the build stays green. Existence alone is
# not enough -- a package.json without `workspaces` fails the walk just as
# completely, so the node check asserts the property the walk actually tests
# rather than the file being present.

# Scan workspaces (`hexagen-scan-*`, `hexagen-clone-*`, `hexagen-handoff-*`).
# Under /app so the walk above terminates at /app/node_modules — os.tmpdir()
# gives `/tmp/... -> /tmp -> /`, which never passes it. Pre-created and chowned
# because /app is not writable by the non-root runtime user; same pattern as
# /data. Nothing sweeps this directory the way the OS sweeps /tmp, so every
# creator deletes its own workspace in a `finally`
# (apps/web/app/lib/project-scan/*).
ENV HEXAGEN_SCAN_WORKSPACE_DIR=/app/.scan-workspaces
RUN mkdir -p /app/.scan-workspaces && chown nextjs:nodejs /app/.scan-workspaces

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production
ENV YARN_ENABLE_IMMUTABLE_INSTALLS=false

# Execute the server - Yarn PnP will resolve modules via .pnp.cjs and .yarn/
CMD ["node", "apps/web/server.js"]
