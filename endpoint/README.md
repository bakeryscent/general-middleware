# Endpoint Harness

This folder mirrors the `tts_api/endpoint` concept—a small CLI that exercises the middleware exactly the way client devices will. It’s useful for smoke tests or Dokploy health checks.

## Usage
```bash
cd endpoint
bun run index.ts -- --url https://middleware.example.com --message "ping"
```

Options:
- `--url` (default `http://localhost:3000`)
- `--path` (default `/api/echo`)
- `--message` (default `"Hello from endpoint"`)

The script POSTs `{ "message": ... }` and prints latency + response body. Extend it to call downstream services (e.g., add a `--service` flag and forward to `/api/service-x`).
