FROM node:26.1.0-bookworm AS admin-builder

WORKDIR /app
COPY .npmrc pnpm-lock.yaml pnpm-workspace.yaml ./
COPY admin/package.json ./admin/package.json
COPY admin/tsconfig.json admin/vite.config.ts ./admin/
COPY admin/index.html ./admin/index.html
COPY admin/src ./admin/src
RUN corepack enable
RUN pnpm install --filter tgbot-gate-admin --frozen-lockfile
RUN pnpm --filter tgbot-gate-admin run build

FROM rust:1.95.0-bookworm AS rust-builder

WORKDIR /app
COPY Cargo.toml ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=rust-builder /app/target/release/tgbot-gate /usr/local/bin/tgbot-gate
COPY --from=admin-builder /app/admin/dist ./admin/dist

ENV PORT=8080
ENV DATA_PATH=/app/data/bots.json
ENV ADMIN_DIST_DIR=/app/admin/dist
EXPOSE 8080

CMD ["tgbot-gate"]
