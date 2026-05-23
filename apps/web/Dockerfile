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

# Post-build safety: fail if a raw OpenAI/Anthropic-shaped key is embedded in client bundle
RUN cd apps/web && \
    if grep -rE 'sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}' .next/static; then \
      echo "FATAL: API key value leak detected in client bundle" && exit 1; \
    fi

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
