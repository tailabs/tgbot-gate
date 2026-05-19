# TG Bot Gate

TG Bot Gate is a lightweight Telegram Bot API gateway. It lets you register bot tokens in a small admin console and proxies requests only for registered bots.

The service is designed for simple self-hosting: one Rust backend, a built React admin UI, SQLite on disk, and Railway-friendly deployment.

## Features

- Telegram-compatible proxy routes: `/bot<TOKEN>/<METHOD>`
- Admin UI for registering and removing bot tokens
- SHA-256 token hash storage
- In-memory token hash cache for fast request authorization
- SQLite storage for bots, settings, and optional audit capture
- Docker and Railway deployment support

## How It Works

1. An admin registers a Telegram bot token in the web UI.
2. The service hashes the token and stores only the hash on disk.
3. Incoming proxy requests keep the standard Telegram path format.
4. The gateway hashes the request token and checks it against the in-memory cache.
5. Registered tokens are forwarded to Telegram. Unknown tokens are rejected.

Example proxy path:

```text
/bot123456:ABC/sendMessage
```

## Quick Start

Build the admin UI:

```bash
cd admin
pnpm install
pnpm run build
cd ..
```

Run the service:

```bash
ADMIN_PASSWORD='change-me' cargo run
```

Open the admin console:

```text
http://localhost:8080/admin
```

## Configuration

### Environment variables (runtime only)

These must be set before the process starts:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listen port |
| `GATE_DB_PATH` | `data/gate.db` | SQLite database path |
| `DATA_PATH` | `data/bots.json` | Legacy path used only to derive the default `GATE_DB_PATH` parent directory |
| `ADMIN_DIST_DIR` | `admin/dist` | Built admin UI directory |
| `ADMIN_PASSWORD` | generated once | Optional bootstrap password; stored as a hash in SQLite afterward |

If `ADMIN_PASSWORD` is not set and the database has no admin hash yet, the service generates a password at startup and prints it to the logs.

### Admin Settings (stored in SQLite)

Audit, proxy limits, and the admin password can be changed in the admin UI under **Settings** without restarting the service:

- Stdout JSON audit log (`/bot...` only)
- SQLite audit capture, retention, errors-only mode, max body size
- Max proxy request body size
- Admin password

On first startup, legacy environment variables (`AUDIT_*`, `MAX_PROXY_BODY_BYTES`) are read once, written into the database, and then ignored.

## Proxy Usage

After registering a bot token, call this service with the same method path you would use for Telegram:

```bash
curl -X POST 'https://your-domain.example/bot123456:ABC/sendMessage' \
  -H 'content-type: application/json' \
  -d '{"chat_id":"123456","text":"hello"}'
```

Unregistered tokens return `403 Forbidden`.

### Audit list API

When audit capture is enabled in Settings, `GET /api/audit` supports pagination and search:

| Query | Default | Description |
| --- | --- | --- |
| `page` | `1` | Page number (1-based) |
| `page_size` | `20` | Items per page (max 100) |
| `q` | — | Search path, method, client IP, or request/response bodies |
| `kind` | — | `proxy` (only proxy traffic is recorded) |
| `min_status` | — | Minimum HTTP status code |

## Deployment

### 1. Railway (one-click)

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/telegram-bot-api-gateway?referralCode=kubernetes&utm_medium=integration&utm_source=template&utm_campaign=generic)

1. Click **Deploy on Railway** and connect this repository (or use the template).
2. Set variables:
   - `ADMIN_PASSWORD` — strong admin password (required).
   - `GATE_DB_PATH` — `/app/data/gate.db` (recommended).
3. Attach a [Railway volume](https://docs.railway.com/guides/volumes) at `/app/data` so SQLite survives redeploys.
4. Generate a public domain; open `https://<your-domain>/admin` and register bot tokens.

Railway sets `PORT` and terminates HTTPS. Enable audit capture under **Settings** after deploy, or set `AUDIT_CAPTURE=1` once before first boot to seed the database.

### 2. Self-hosted Docker

The image is defined in `Dockerfile` (admin UI + Rust binary). CI publishes tags to GitHub Container Registry on `main` and version tags.

**Option A — build on the server**

```bash
git clone https://github.com/tailabs/tgbot-gate.git
cd tgbot-gate
docker build -t tgbot-gate:local .
```

**Option B — pull prebuilt image (after GHCR publish)**

```bash
docker pull ghcr.io/tailabs/tgbot-gate:latest
```

**Run (replace secrets and host port as needed)**

```bash
docker volume create tgbot-gate-data

docker run -d \
  --name tgbot-gate \
  --restart unless-stopped \
  -p 8080:8080 \
  -e ADMIN_PASSWORD='change-me-to-a-strong-password' \
  -e GATE_DB_PATH=/app/data/gate.db \
  -v tgbot-gate-data:/app/data \
  tgbot-gate:local
```

Use `ghcr.io/tailabs/tgbot-gate:latest` instead of `tgbot-gate:local` when pulling from GHCR.

**Verify**

```bash
docker logs tgbot-gate
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/healthz
```

Admin UI: `http://<server-ip>:8080/admin` (put a reverse proxy in front for HTTPS in production).

**Shortcut (Makefile)**

```bash
ADMIN_PASSWORD='change-me' make docker
```

This builds `tgbot-gate:local`, creates volume `tgbot-gate-data`, and runs the container on port `8080`.

### Deployment checklist

| Item | Railway | Docker |
| --- | --- | --- |
| Admin password | `ADMIN_PASSWORD` variable | `-e ADMIN_PASSWORD=...` |
| Persistent data | Volume at `/app/data` | `-v tgbot-gate-data:/app/data` |
| Public URL | Railway domain + HTTPS | Your reverse proxy / firewall |
| Bot proxy base | `https://<domain>/bot<TOKEN>/...` | `http(s)://<host>/bot<TOKEN>/...` |

## Development

Run the frontend dev server:

```bash
cd admin
pnpm run dev
```

Run backend checks:

```bash
cargo fmt --all -- --check
cargo test
cargo check
```

Build the frontend:

```bash
cd admin
pnpm run build
```

## Security Notes

- Raw bot tokens are not stored on disk.
- The registry stores token hashes, labels, and creation timestamps in SQLite.
- Admin sessions use an HTTP-only cookie.
- Keep `ADMIN_PASSWORD` private.
- Do not commit `.env`, `data/`, `admin/dist/`, or dependency directories.

## License

[MIT](LICENSE)
