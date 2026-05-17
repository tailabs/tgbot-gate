# TG Bot Gate

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/Piv1dC?referralCode=kubernetes&utm_medium=integration&utm_source=template&utm_campaign=generic)

TG Bot Gate is a lightweight Telegram Bot API gateway. It lets you register bot tokens in a small admin console and proxies requests only for registered bots.

The service is designed for simple self-hosting: one Rust backend, a built React admin UI, local disk storage, and Railway-friendly deployment.

## Features

- Telegram-compatible proxy routes: `/bot<TOKEN>/<METHOD>`
- Admin UI for registering and removing bot tokens
- SHA-256 token hash storage
- In-memory token hash cache for fast request authorization
- Local JSON storage with no database requirement
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

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port for the service |
| `GATE_DB_PATH` | `data/gate.db` | SQLite database (bots, admin password hash, audit shards) |
| `DATA_PATH` | `data/bots.json` | Legacy path used only to derive default `GATE_DB_PATH` parent directory |
| `ADMIN_PASSWORD` | generated at startup | Password for the admin console |
| `ADMIN_DIST_DIR` | `admin/dist` | Built admin UI directory |
| `AUDIT_LOG` | `1` (on) | JSON audit lines on stdout for Telegram proxy routes only (`/bot...`); set `0` to disable |
| `AUDIT_CAPTURE` | `0` (off) | Persist Telegram proxy request/response bodies to `gate.db`; set `1` to enable |
| `AUDIT_RETENTION_DAYS` | `7` | Drop monthly audit shard tables older than this many days |
| `AUDIT_ERRORS_ONLY` | `0` (off) | When `1`, only capture entries with HTTP status >= 400 |
| `AUDIT_MAX_BODY_BYTES` | same as `MAX_PROXY_BODY_BYTES` | Max bytes buffered per request/response body for audit |

If `ADMIN_PASSWORD` is not set, the service generates one at startup and prints it to the logs. Set a fixed password for production.

## Proxy Usage

After registering a bot token, call this service with the same method path you would use for Telegram:

```bash
curl -X POST 'https://your-domain.example/bot123456:ABC/sendMessage' \
  -H 'content-type: application/json' \
  -d '{"chat_id":"123456","text":"hello"}'
```

Unregistered tokens return `403 Forbidden`.

### Audit list API

When `AUDIT_CAPTURE=1`, `GET /api/audit` supports pagination and search:

| Query | Default | Description |
| --- | --- | --- |
| `page` | `1` | Page number (1-based) |
| `page_size` | `20` | Items per page (max 100) |
| `q` | — | Search path, method, client IP, or request/response bodies |
| `kind` | — | `proxy` (only proxy traffic is recorded) |
| `min_status` | — | Minimum HTTP status code |

## Railway Deployment

The repository includes:

- `Dockerfile`
- `railway.json`

Set at least:

```text
ADMIN_PASSWORD=<strong-password>
GATE_DB_PATH=/app/data/gate.db
AUDIT_CAPTURE=1
```

Railway provides the public domain and HTTPS. The app listens on the `PORT` value provided by the platform.

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
- The registry file contains token hashes, labels, and creation timestamps.
- Admin sessions use an HTTP-only cookie.
- Keep `ADMIN_PASSWORD` private.
- Do not commit `.env`, `data/`, `admin/dist/`, or dependency directories.

## License

[MIT](LICENSE)
