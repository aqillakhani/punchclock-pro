# syntax=docker/dockerfile:1
#
# PunchClock Pro API — multi-stage build for a pnpm workspace.
#
# IMPORTANT: the build context must be the MONOREPO ROOT (it needs the root
# lockfile + the @punchclock/shared package). Deploy from the repo root:
#
#   flyctl deploy . --remote-only \
#     --config packages/api/fly.toml \
#     --dockerfile packages/api/Dockerfile
#
# Or build locally:  docker build -f packages/api/Dockerfile -t punchclock-api .

# ---- Build stage: full node image (has the toolchain native deps like
#      bcrypt need), installs the API's dependency closure and compiles it. ----
FROM node:20 AS build
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

COPY . .

# Install only what the API needs (itself + @punchclock/shared), reproducibly.
RUN pnpm install --frozen-lockfile --filter "@punchclock/api..."

# Compile shared first — the API imports its built dist — then the API.
RUN pnpm --filter @punchclock/shared build \
 && pnpm --filter @punchclock/api build

# Emit a self-contained, production-only bundle (flat node_modules + dist +
# the bundled shared package) to /prod.
RUN pnpm --filter @punchclock/api deploy --prod /prod

# ---- Runtime stage: slim image, non-root, just the prod bundle. ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
# Fly maps public 443 -> this internal port.
ENV API_PORT=8080
WORKDIR /app

COPY --from=build /prod ./

USER node
EXPOSE 8080

# Fail fast on an unhandled boot error; Fly restarts the machine.
CMD ["node", "dist/index.js"]
