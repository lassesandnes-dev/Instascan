# syntax=docker/dockerfile:1
# Build from the repository root:  docker build -f apps/web/Dockerfile .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @massefelt/database generate && pnpm --filter @massefelt/web build

FROM base AS runtime
ENV NODE_ENV=production PORT=3000
COPY --from=build /repo /repo
RUN useradd --system --uid 1001 massefelt && mkdir -p /repo/.data && chown -R massefelt /repo/.data
USER massefelt
EXPOSE 3000
# Apply migrations, then start the server.
CMD ["sh", "-c", "pnpm --filter @massefelt/database migrate:deploy && pnpm --filter @massefelt/web start"]
