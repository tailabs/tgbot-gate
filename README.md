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

## Railway Deployment

The repository includes:

- `Dockerfile`
- `railway.json`

Set at least:

```text
ADMIN_PASSWORD=<strong-password>
GATE_DB_PATH=/app/data/gate.db
```

Enable audit capture from **Settings** in the admin UI after deploy (or set `AUDIT_CAPTURE=1` once before first boot to seed the database).

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
