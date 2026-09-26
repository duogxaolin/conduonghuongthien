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

# Reject an ADMIN_PASSWORD the seed will refuse, BEFORE paying for the build.
# `.env` is excluded from the build context (.dockerignore), so the value arrives
# as a BuildKit secret: never written to a layer and absent from `docker history`.
# `required=false` keeps builds that supply nothing working — the guard then warns
# and passes, because on an existing deployment the admin account already exists.
RUN --mount=type=secret,id=admin_password,required=false \
    ADMIN_PASSWORD_FILE=/run/secrets/admin_password npm run check:admin-password

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

# FFmpeg/ffprobe transcode uploaded video, so they belong in the RUNTIME stage —
# `nuxi build` never invokes them, and installing them in the builder stage would
# add ~100 MB to a layer that never reaches the image serving traffic. Alpine's
# ffmpeg carries libx264, native aac and the hls muxer (verified by running
# `apk add --no-cache ffmpeg` on node:22-alpine), so no community repository is
# needed. `nice`, which video-processing.ts puts in front of every ffmpeg call to
# keep transcode at the lowest priority, ships with BusyBox — nothing to add.
# `cpulimit` giới hạn % CPU thật cho ffmpeg (MEDIA_PROCESSING_CPU_LIMIT, mặc định 50),
# không phải chỉ ưu tiên thấp như `nice` — một lượt transcode không ăn sạch mọi nhân.
RUN apk add --no-cache ffmpeg mysql-client cpulimit su-exec

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Media work directory. Same shape as HOST/PORT above: a default baked into the
# image, overridden by compose for the real deployment. The volume mount point
# must exist in the image and be owned by the runtime user, because a freshly
# created named volume inherits the ownership of the directory it is mounted
# over — created at first use by root, it would be unwritable by `node` forever.
# `uploads/` and `media/` are deliberately NOT pre-created here: the code creates
# them with `{ recursive: true }` on first use, and a second place declaring the
# layout is a second place to keep in step.
ENV CDKT_MEDIA_WORKDIR=/var/lib/cdkt/media

# Uploads and media are written at runtime; give the unprivileged user ownership
# so a freshly created named volume inherits it.
RUN mkdir -p /app/public/uploads /app/backups /var/lib/cdkt/media && chown -R node:node /app /var/lib/cdkt

EXPOSE 3000

# Drop privileges via entrypoint so bind mounts (./backups) owned by root on the host
# are chowned to node on startup. The entrypoint runs as root, fixes ownership,
# then execs as node via su-exec.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/public/settings').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Initialise schema, seed missing rows (both idempotent), then serve.
# Uses Node's built-in TypeScript stripping — no `tsx` install needed at runtime.
CMD ["sh", "-c", "node --experimental-strip-types --import ./scripts/ts-resolver.mjs server/db/init.ts && node --experimental-strip-types --import ./scripts/ts-resolver.mjs server/db/seed.ts && node .output/server/index.mjs"]
