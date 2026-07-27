# ─── Stage 1: Build ───────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# `npm ci` (not `npm install`) so the image is reproducible from package-lock.json.
COPY package*.json ./
RUN npm ci

COPY . .

# The build reads ANALYTICS_HMAC_SECRET while evaluating nuxt.config. The real
# value is supplied at RUNTIME via NUXT_ANALYTICS_HMAC_SECRET (Nitro reads the
# NUXT_-prefixed name), so this placeholder never serves production traffic.
ENV NODE_ENV=production
ENV ANALYTICS_HMAC_SECRET=build-time-placeholder-not-used-at-runtime-32chars

RUN npx nuxi build

# ─── Stage 2: Runtime ─────────────────────────────
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Built server + the sources the DB bootstrap scripts need.
COPY --from=builder /app/.output ./.output
COPY server ./server
COPY scripts ./scripts
COPY public ./public

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Uploads are written at runtime; give the unprivileged user ownership so a
# freshly created named volume inherits it.
RUN mkdir -p /app/public/uploads && chown -R node:node /app

EXPOSE 3000

# Drop root privileges.
# NOTE for EXISTING deployments: a volume created by an older (root) image keeps
# root ownership. Run once after upgrading, otherwise uploads will fail:
#   docker compose run --rm --user root app chown -R node:node /app/public/uploads
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/public/settings').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Initialise schema, seed missing rows (both idempotent), then serve.
# Uses Node's built-in TypeScript stripping — no `tsx` install needed at runtime.
CMD ["sh", "-c", "node --experimental-strip-types --import ./scripts/ts-resolver.mjs server/db/init.ts && node --experimental-strip-types --import ./scripts/ts-resolver.mjs server/db/seed.ts && node .output/server/index.mjs"]
