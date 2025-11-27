# Dokploy Deployment

This folder mirrors the `tts_api/deploy` subtree but focuses on Dokploy workflows. Dokploy watches your Git repo, builds the Dockerfile, and redeploys automatically on push.

## Quick start
1. Push this repository (or at least the `middleware` folder) to the Git provider connected to Dokploy.
2. In Dokploy, create a new **Git App** and select the repo + branch.
3. Set the context directory to `api` so Dokploy uses the middleware Dockerfile.
4. Provide any required environment variables (e.g. `PORT=3000`, downstream API keys, logging tokens).
5. Configure the health check path `/api/ping` and port `3000`.
6. Enable **Auto Deploy on Push** so Dokploy rebuilds after every git push.

## Template
`app.template.yaml` shows a declarative configuration you can paste into Dokploy's YAML editor. Update the repository URL, resource requests, and env vars before applying.

## Secrets / environment variables
- `PORT` (default 3000)
- `NODE_ENV` ("production")
- Any downstream service tokens (e.g. `SERVICE_A_TOKEN`, `SERVICE_B_URL`)

Store secrets inside Dokploy's environment/secrets UI; they will be injected into the container at runtime.

## Pipeline tips
- Dokploy automatically runs `docker build` using `api/Dockerfile`; no extra scripts are required.
- Use Dokploy's cron or webhook triggers if you later mirror the AWS Terraform automation from `tts_api`.
- To roll back, choose a previous deployment directly in Dokploy.
