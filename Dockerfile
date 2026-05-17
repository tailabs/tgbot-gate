# syntax=docker/dockerfile:1

# --- Admin: install deps only when lockfiles / package.json change ---
FROM node:26.1.0-bookworm AS admin-builder

WORKDIR /app

RUN npm install -g pnpm@11.0.9

COPY .npmrc pnpm-lock.yaml pnpm-workspace.yaml ./
COPY admin/package.json ./admin/package.json

RUN --mount=type=cache,id=tgbot-pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --filter tgbot-gate-admin --frozen-lockfile

COPY admin/tsconfig.json admin/vite.config.ts ./admin/
COPY admin/index.html ./admin/index.html
COPY admin/src ./admin/src

RUN pnpm --filter tgbot-gate-admin run build

# --- Rust: cache registry + target between builds ---
FROM rust:1.95.0-bookworm AS rust-builder

WORKDIR /app

ENV CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse

COPY Cargo.toml Cargo.lock ./
COPY src ./src

RUN --mount=type=cache,id=tgbot-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=tgbot-cargo-git,target=/usr/local/cargo/git \
    --mount=type=cache,id=tgbot-target,target=/app/target \
    cargo build --locked --release \
    && install -Dm755 target/release/tgbot-gate /out/tgbot-gate \
    && strip /out/tgbot-gate

# --- Runtime ---
FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=rust-builder /out/tgbot-gate /usr/local/bin/tgbot-gate
COPY --from=admin-builder /app/admin/dist ./admin/dist

ENV PORT=8080
ENV GATE_DB_PATH=/app/data/gate.db
ENV ADMIN_DIST_DIR=/app/admin/dist

EXPOSE 8080

CMD ["tgbot-gate"]
