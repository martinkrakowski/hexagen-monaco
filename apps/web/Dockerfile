# ---------- 1️⃣  Build stage ----------
FROM node:20-alpine AS base

# Enable corepack and set Yarn version
RUN corepack enable && corepack prepare yarn@4.12.0 --activate

FROM base AS builder
WORKDIR /app

# Copy the entire repository (respecting .dockerignore)
COPY . .

# Install all dependencies (including dev) – Yarn 2+ uses `yarn install`
RUN echo 'nodeLinker: node-modules' > .yarnrc.yml && yarn install

# Hard cap Node.js memory to 4GB to leave 3GB for Docker/Ubuntu OS
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV NEXT_TELEMETRY_DISABLED=1

# Build only the web app and its dependencies, one at a time (memory optimization)
RUN yarn turbo build --filter=web... --concurrency=1

# ---------- 2️⃣  Runtime stage ----------
FROM node:20-alpine AS runner
WORKDIR /app

# Enable corepack for Yarn 4
RUN corepack enable && corepack prepare yarn@4.12.0 --activate

# Only need production deps + the built output
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Copy the entire standalone directory to preserve monorepo structure
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./

# Copy static assets to the mirrored path
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production
ENV YARN_ENABLE_IMMUTABLE_INSTALLS=false

# Execute the server - Yarn PnP will resolve modules via .pnp.cjs and .yarn/
CMD ["node", "apps/web/server.js"]
