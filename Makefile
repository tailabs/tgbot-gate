.PHONY: dev build docker

# Build release binary locally
build:
	cargo build --release

# Run locally with logging
dev:
	RUST_LOG=info cargo run

# Build and run Docker image
docker:
	docker build -t tgbot-gate:local .
	docker rm -f tgbot-gate 2>/dev/null || true
	docker run -d --name tgbot-gate \
		-p 8080:8080 \
		-e ADMIN_PASSWORD=changeme \
		-v tgbot-gate-data:/app/data \
		tgbot-gate:local
	docker logs -f tgbot-gate
