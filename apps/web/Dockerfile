# ---------- 1️⃣  Build stage ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace lockfile and package manifests (yarn uses yarn.lock)
COPY package.json yarn.lock ./
COPY packages ./packages
COPY apps ./apps

# Install all dependencies (including dev) – Yarn 2+ uses `yarn install`
RUN yarn install --frozen-lockfile

# Build the web app (adjust if your build script is different)
RUN yarn workspace web build

# ---------- 2️⃣  Runtime stage ----------
FROM node:20-alpine AS runner
WORKDIR /app

# Only need production deps + the built output
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

COPY --from=builder /app/package.json ./
COPY --from=builder /app/yarn.lock ./
RUN yarn install --production --frozen-lockfile

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./.next/static
COPY --from=builder /app/apps/web/public ./public

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production
CMD ["node", "server.js"]