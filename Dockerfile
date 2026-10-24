# ─── Stage 1: Build ───────────────────────────────
# Node 24 LTS — Node 22 has a test-runner IPC bug under
# `--experimental-test-module-mocks` (processRawBuffer deserialize), and 24 is
# the LTS `engines` permits (^24.11.0). Runtime behaves identically for Nitro.
FROM node:24-alpine AS builder

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
FROM node:24-alpine

# Layer order is a deploy cost, not style. Every layer after the first one whose
# input changed is rebuilt — new digest — and re-pulled by the VPS. The OS
# packages and the empty mount points change almost never, so they come FIRST;
# node_modules changes with package*.json; the app files change on every commit
# and come LAST. (Measured with `docker history`: with apk after the app COPYs
# and a `chown -R node:node /app` at the end, every deploy re-pulled the 175 MB
# apk layer plus a 204 MB copy of the whole app made by that chown.)

# FFmpeg/ffprobe transcode uploaded video, so they belong in the RUNTIME stage —
# `nuxi build` never invokes them, and installing them in the builder stage would
# add ~100 MB to a layer that never reaches the image serving traffic. Alpine's
# ffmpeg carries libx264, native aac and the hls muxer (verified by running
# `apk add --no-cache ffmpeg` on node:24-alpine), so no community repository is
# needed. `nice`, which video-processing.ts puts in front of every ffmpeg call to
# keep transcode at the lowest priority, ships with BusyBox — nothing to add.
# `cpulimit` giới hạn % CPU thật cho ffmpeg (MEDIA_PROCESSING_CPU_LIMIT, mặc định 50),
# không phải chỉ ưu tiên thấp như `nice` — một lượt transcode không ăn sạch mọi nhân.
RUN apk add --no-cache ffmpeg mysql-client cpulimit su-exec

# Giờ Việt Nam cho tiến trình (lịch 03:00 của analytics/retention/sao lưu, đầu
# tháng của hạn mức AI). Alpine không kèm cơ sở dữ liệu múi giờ, nên `tzdata`
# để libc và các công cụ ngoài Node (`date`, mysqldump, ffmpeg) cũng hiểu TZ.
# Chỉ image app — container mysql giữ UTC. Xem chú thích TZ trong docker-compose.yml.
RUN apk add --no-cache tzdata
ENV TZ=Asia/Ho_Chi_Minh

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

# Drop privileges via entrypoint so bind mounts (./backups) owned by root on the host
# are chowned to node on startup. The entrypoint runs as root, fixes ownership,
# then execs as node via su-exec.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

WORKDIR /app

# The mount points, created EMPTY and handed to the unprivileged user so a freshly
# created named volume inherits node's ownership. `/app` itself too (the server
# runs with it as cwd), but NOT recursively: the app files below get their owner
# from `COPY --chown` as they land, and a `chown -R` here would copy every one of
# them into a new layer.
RUN mkdir -p /app/public/uploads /app/backups /var/lib/cdkt/media \
 && chown node:node /app /app/public /app/public/uploads /app/backups /var/lib/cdkt /var/lib/cdkt/media

COPY --chown=node:node package*.json ./
# Runtime = only `dependencies` (what db:init/db:seed/scripts import; `.output` is
# self-contained — Nitro traced what it needs). `--ignore-scripts` is REQUIRED:
# the root `postinstall` is `nuxt prepare`, and nuxt is a devDependency now, so
# the hook would fail with "nuxt: command not found". No runtime package needs
# an install script (sharp ships prebuilt binaries via optional deps).
# Run as `node`, so node_modules is node's — the ownership the old recursive chown
# produced, without a second copy of it.
USER node
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
# Back to root: the entrypoint must fix bind-mount ownership before it drops to
# node with su-exec.
USER root

# Built server + the sources the DB bootstrap scripts need. Last: they change on
# every commit. `.output` is self-contained, but init.ts/seed.ts and every
# `npm run db:*`/`scripts/*.ts` run from SOURCE with --experimental-strip-types, and
# server/ imports values from shared/ (permissions, settings-credential-rules) —
# without it those imports die with ERR_MODULE_NOT_FOUND inside the container only.
# tests/runtime-image-sources.test.ts walks the import graph and fails on a gap.
COPY --chown=node:node --from=builder /app/.output ./.output
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node public ./public

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/public/settings').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The commit this image was built from (CI passes the short SHA; a local build
# leaves it empty and /api/public/health reports "dev"). The LAST layer before CMD
# so a new value invalidates no cached layer above it. Baked into the image rather
# than passed by compose: the value belongs to the image, and compose would have to
# be told it on every deploy.
ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION

# Initialise schema, seed missing rows (both idempotent), then serve.
# Uses Node's built-in TypeScript stripping — no `tsx` install needed at runtime.
# `exec` makes the server PID 1, so `docker stop` (SIGTERM) reaches Node and Nitro
# drains within stop_grace_period (docker-compose.yml) instead of being SIGKILLed.
# BusyBox sh happens to exec the last command of a `-c` list already; this says so
# rather than relying on it.
CMD ["sh", "-c", "node --experimental-strip-types --import ./scripts/ts-resolver.mjs server/db/init.ts && node --experimental-strip-types --import ./scripts/ts-resolver.mjs server/db/seed.ts && exec node .output/server/index.mjs"]
