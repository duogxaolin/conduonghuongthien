# ─── Stage 1: Build ───────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Build needs ANALYTICS_HMAC_SECRET — use a dummy value at build time
# (real value is injected at runtime via docker-compose env)
ENV NODE_ENV=production
ENV ANALYTICS_HMAC_SECRET=build-time-placeholder-not-used-at-runtime-32chars

RUN npx nuxi build

# ─── Stage 2: Runtime ─────────────────────────────
FROM node:22-alpine

WORKDIR /app

# Copy package files and install production + tsx dependency
COPY package*.json ./
RUN npm install --omit=dev && npm install tsx

# Copy built output from builder
COPY --from=builder /app/.output ./.output

# Copy server scripts for DB init/seed (need tsx to run)
COPY server ./server

# Copy public assets (TinyMCE plugins, uploads placeholder)
COPY public ./public

ENV NODE_ENV=production
ENV HOST=0.0.0.0

EXPOSE ${PORT:-54432}

# Auto-initialize DB, seed, then start server
CMD sh -c "npx tsx server/db/init.ts && npx tsx server/db/seed.ts && node .output/server/index.mjs"
