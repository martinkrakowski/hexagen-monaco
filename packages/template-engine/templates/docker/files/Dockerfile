# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Multi-stage build. Final image carries only production node_modules and the
# compiled Next.js output — no source, no devDependencies. Typically 60–70%
# smaller than a single-stage build.
#
# Stages: base → deps (prod deps) → builder (compile) → runner (minimal)
# ---------------------------------------------------------------------------

# ---- base: shared foundation -------------------------------------------------
FROM node:{node_version}-alpine AS base
WORKDIR /app
# libc6-compat keeps some native npm modules (e.g. sharp) happy on Alpine.
RUN apk add --no-cache libc6-compat

# ---- deps: install production dependencies only ------------------------------
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ---- builder: full install + compile ----------------------------------------
FROM base AS builder
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner: minimal production image ---------------------------------------
FROM node:{node_version}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Run as an unprivileged user.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/.next        ./.next
COPY --from=builder /app/public       ./public
COPY --from=builder /app/package.json ./package.json
# next.config.* is optional — the trailing glob keeps the COPY from failing
# when the project has no config file.
COPY --from=builder /app/next.config.* ./

USER appuser
EXPOSE 3000

# Calls the app's own /api/health route (provided by the observability template).
# Exits 0 on HTTP 200, non-zero otherwise — Docker marks the container unhealthy.
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["npm", "start"]
