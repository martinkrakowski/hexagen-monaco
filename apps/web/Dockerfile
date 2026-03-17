# ---------- 1️⃣  Build stage ----------
FROM node:20-alpine AS base

# Enable corepack and set Yarn version
RUN corepack enable && corepack prepare yarn@4.12.0 --activate

FROM base AS builder
WORKDIR /app

# Copy the entire repository (respecting .dockerignore)
COPY . .

# Install all dependencies (including dev) – Yarn 2+ uses `yarn install`
RUN yarn install

# Build all packages using turbo
RUN yarn turbo build

# ---------- 2️⃣  Runtime stage ----------
FROM node:20-alpine AS runner
WORKDIR /app

# Enable corepack for Yarn 4
RUN corepack enable && corepack prepare yarn@4.12.0 --activate

# Only need production deps + the built output
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

COPY --from=builder /app/apps/web/.next/standalone/apps/web/server.js ./
COPY --from=builder /app/apps/web/.next/standalone/apps/web/package.json ./
COPY --from=builder /app/apps/web/.next/standalone/apps/web/.next/ ./.next/
COPY --from=builder /app/apps/web/.next/static ./.next/static
COPY --from=builder /app/apps/web/.next/standalone/node_modules ./node_modules

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production
CMD ["node", "server.js"]
