# Middleware Stack

This workspace mirrors the `tts_api` shape so middleware, load testing, and deployment assets stay in one place.

```
middleware/
├── api/         # Bun + Elysia service (Dockerized)
├── benchmark/   # Locust suite for smoke/load tests
├── deploy/      # Dokploy config + notes for auto deploy on git push
└── endpoint/    # CLI harness that calls the middleware like a client
```

## Development lifecycle
1. Build/run the API locally (`cd api && bun dev`).
2. Use `endpoint/index.ts` to smoke test the running server.
3. Run `benchmark/locustfile.py` when you need higher load.
4. Push to `main` (or your chosen branch). Dokploy watches the repo, rebuilds the Docker image using `api/Dockerfile`, and deploys automatically.

See the sub-folder READMEs for details on each step.
