# Middleware API

Elysia + Bun service that exposes a lightweight middleware layer. The project mirrors the `tts_api` layout so we can ship the same Docker image to Dokploy.

## Local development

```bash
bun install               # install deps once
bun run --watch src/index.ts   # hot reload
# or
bun start                 # run once
```

## Configuration

| Variable | Required | Description | Default |
| --- | --- | --- | --- |
| `PORT` | No | HTTP port Bun listens on | `3000` |
| `NODE_ENV` | No | Environment label used in logs + OpenTelemetry service name | `development` |
| `INSTANCE_ID` | No | Optional identifier injected into trace resource data | `local` |
| `AXIOM_TOKEN` | No | Required to ship traces to Axiom (enable when you want telemetry) | — |
| `AXIOM_DATASET` | No | Axiom dataset that receives OpenTelemetry spans | — |
| `AXIOM_BASE_URL` | No | Override for regional Axiom base (default US endpoint) | `https://api.axiom.co` |
| `OPENAI_API_KEY` | Yes (for `/api/openai`) | Secret passed to OpenAI's `Authorization` header | — |
| `OPENAI_BASE_URL` | No | Override for the OpenAI REST base URL (useful for proxies / Azure) | `https://api.openai.com/v1` |
| `OPENAI_ORG_ID` | No | Adds `OpenAI-Organization` header when present | — |
| `CLAUDE_API_KEY` / `ANTHROPIC_API_KEY` | Yes (for `/api/claude`) | API key used via the `x-api-key` header | — |
| `CLAUDE_BASE_URL` | No | Override Anthropic's REST base URL | `https://api.anthropic.com/v1` |
| `CLAUDE_API_VERSION` | No | Sets the `anthropic-version` header | `2023-06-01` |
| `CLAUDE_BETA` | No | Optional `anthropic-beta` header for feature flags | — |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Yes (for `/api/gemini`) | API key appended as `?key=` when calling Gemini | — |
| `GEMINI_BASE_URL` | No | Override for Gemini REST base URL | `https://generativelanguage.googleapis.com/v1beta` |
| `GEMINI_DEFAULT_ACTION` | No | Default action appended to `models/{model}:<action>` when `path` not provided | `generateContent` |
| `DEVICECHECK_KEY_ID` | Yes | Apple key ID used to sign DeviceCheck auth tokens | — |
| `DEVICECHECK_TEAM_ID` | Yes | Apple Developer Team ID (used as JWT issuer) | — |
| `DEVICECHECK_PRIVATE_KEY` | Yes | Full text of the DeviceCheck `.p8` key (use literal newlines or `\n`) | — |
| `DEVICECHECK_PRIVATE_KEY_FILE` | Yes (alternative) | Absolute/relative path to the `.p8` key; contents override `DEVICECHECK_PRIVATE_KEY` | — |
| `DEVICECHECK_BASE_URL` | No | Override DeviceCheck REST base URL (handy for sandbox proxies) | `https://api.devicecheck.apple.com/v1` |
| `DEVICECHECK_TIMEOUT_MS` | No | Abort validation calls if Apple does not respond in time | `4000` |

## DeviceCheck enforcement

Every request now requires a valid Apple DeviceCheck token sent via the `x-devicecheck-token` header. The iOS app should call `DCDevice.current.generateToken(completionHandler:)`, base64-encode the binary token, and attach it to each HTTP request. Supply the Apple auth key by either:

- Setting `DEVICECHECK_PRIVATE_KEY` to the literal key string (escape newlines as `\n`).
- Or pointing `DEVICECHECK_PRIVATE_KEY_FILE` at the `.p8` file on disk; the server reads the file at startup.

- Missing or malformed headers return `401`.
- Invalid or expired tokens return the status Apple responds with (typically `400`).
- The middleware verifies each token with Apple in real time, so keep the DeviceCheck credentials configured in the environment.

Example request:

```bash
curl -X POST http://localhost:3000/api/echo \
	-H "Content-Type: application/json" \
	-H "x-devicecheck-token: <base64-device-token>" \
	-d '{
		"message": "Hello"
	}'
```

If you need to exempt infrastructure probes (eg. uptime checks) from DeviceCheck, place them behind a small shim service that can attach a valid token, or add an allowlist in code before the DeviceCheck guard.

### Troubleshooting DeviceCheck failures

When the server rejects a token it responds with structured JSON:

```json
{
	"message": "Invalid DeviceCheck token",
	"reason": "{\"error\":\"Invalid device token\"}"
}
```

- **`message`** is a human summary (`Missing DeviceCheck token`, `DeviceCheck validation failed`, etc.).
- **`reason`** is the raw body returned by Apple; it can be JSON or plain text. Log this client-side to understand whether the token was reused, expired, or malformed.

Server visibility:

1. **Logs** – each rejection prints `DeviceCheck rejected` with `path`, `status`, and `reason` so container logs show the exact Apple error.
2. **Axiom traces** – the HTTP span carries `devicecheck.status`, `devicecheck.reason`, and `devicecheck.path`. Filter `status.code == "ERROR"` to see failures live.
3. **Span exceptions** – every failure records an exception event; in Axiom open the trace and inspect the error event for the same details.

Common causes:

- `Invalid device token` – token reused or generated without entitlement.
- `Missing DeviceCheck token` – header absent (ensure keyboards send `x-devicecheck-token`).
- `DeviceCheck validation timed out` – Apple endpoint unreachable; retry with exponential backoff.
- `DeviceCheck validation request failed` – network error between server and Apple; check upstream connectivity.

## Axiom telemetry

Set `AXIOM_TOKEN` (ingest scope) and `AXIOM_DATASET` to push OpenTelemetry spans straight into Axiom. When those env vars are present the server wires an OTLP HTTP exporter and automatically sends:

- One span per HTTP request with route/method/status metadata.
- Error spans whenever DeviceCheck rejects a call or an upstream provider (OpenAI, etc.) fails; the span status is marked `ERROR` with stack traces so you can pivot directly from Live view.

### Verifying in Axiom

1. Deploy with the Axiom env vars set (or run locally with them in `.env`).
2. Generate a failing request (eg. omit `x-devicecheck-token`) to trigger an error span.
3. Open Axiom → your dataset → **Live** tab and you should see the span arrive within a couple seconds (filter by `service.name == "${telemetryServiceName}"`).

You can build dashboards or alerts on the dataset using `status_code >= 400` or `span.status.code == "ERROR"` to watch for regressions.

## Code structure

```
api/
└─ src/
	├─ app.ts               # Elysia instance wiring telemetry + routes
	├─ config/              # Environment + provider config helpers
	├─ clients/             # Provider-specific HTTP clients (OpenAI, Claude, Gemini)
	├─ lib/                 # Shared JSON/HTTP utilities
	├─ routes/              # Route modules (health + api namespaces)
	└─ index.ts             # Bootstraps the server via createApp()
```

## API endpoints

- `GET /` – service status + metadata
- `GET /api/ping` – simple pong response
- `POST /api/echo` – echoes `{ message }`
- `POST /api/openai` – forwards arbitrary payloads to OpenAI while keeping the API key server-side
- `POST /api/claude` – forwards payloads to Anthropic's Claude API
- `POST /api/gemini` – proxies Google Gemini requests (Generative Language API)
- `POST /api/humanizer/detect` – scores text with OpenAI `gpt-5-nano` and returns a 0-100 AI probability integer
- `POST /api/humanizer/humanize` – rewrites text with `gpt-5-nano` to sound more human

### `POST /api/openai`

Send any OpenAI payload by specifying the model plus the REST path to hit (defaults to `v1/responses`). The server injects your API key and streams the JSON response back.

```bash
curl -X POST http://localhost:3000/api/openai \
	-H "Content-Type: application/json" \
	-d '{
		"model": "gpt-4o-mini",
		"path": "responses",
		"payload": {
			"input": [
				{
					"role": "user",
					"content": "Write a haiku about middleware"
				}
			],
			"temperature": 0.4
		}
	}'
```

`payload` can contain any fields that a given OpenAI endpoint expects (messages, input, temperature, tools, etc.). Whatever object you send is merged with the `model` you provide so the server can support *any* current or future model without code changes.

### `POST /api/claude`

Works just like the OpenAI proxy but defaults to Anthropic's `/v1/messages` endpoint.

```bash
curl -X POST http://localhost:3000/api/claude \
	-H "Content-Type: application/json" \
	-d '{
		"model": "claude-3-5-sonnet-latest",
		"path": "messages",
		"payload": {
			"messages": [
				{
					"role": "user",
					"content": "Summarize middleware responsibilities"
				}
			],
			"max_tokens": 300
		}
	}'
```

The `payload` object is merged with `model` and sent as-is, enabling support for any Anthropic feature set (tool use, reasoning, etc.) without further code changes.

### `POST /api/gemini`

Defaults to hitting `models/{model}:generateContent` with your request body unless you override `path`.

```bash
curl -X POST http://localhost:3000/api/gemini \
	-H "Content-Type: application/json" \
	-d '{
		"model": "gemini-1.5-flash",
		"payload": {
			"contents": [
				{
					"role": "user",
					"parts": [
						{ "text": "List 3 benefits of middleware" }
					]
				}
			],
			"generationConfig": {
				"temperature": 0.3
			}
		}
	}'
```

If you need to call a different action (eg. `models/gemini-1.5-pro:batchEmbedContents`), provide the exact REST path via the `path` field.

### `POST /api/humanizer/detect`

Returns an integer between `0` and `100` indicating how likely the submitted text is AI-generated.

```bash
curl -X POST http://localhost:3000/api/humanizer/detect \
	-H "Content-Type: application/json" \
	-H "x-devicecheck-token: <token>" \
	-d '{
		"text": "The middleware abstracted request pipelining in a highly systematic manner."
	}'
# -> 64
```

### `POST /api/humanizer/humanize`

Rewrites the text to sound more natural based on OpenAI `gpt-5-nano`.

```bash
curl -X POST http://localhost:3000/api/humanizer/humanize \
	-H "Content-Type: application/json" \
	-H "x-devicecheck-token: <token>" \
	-d '{
		"text": "The middleware abstracted request pipelining in a highly systematic manner."
	}'
# -> "Our middleware keeps requests flowing smoothly without feeling robotic."
```

## Docker (Dokploy ready)

Build and run the image locally:

```bash
docker build -t middleware-api .
docker run --rm -p 3000:3000 -e PORT=3000 middleware-api
```

### Dokploy deployment
1. Push this repo (or at least `middleware/api`) to the Git provider linked to Dokploy.
2. In Dokploy create a new **Docker Deploy** and point it at this directory.
3. Configure build command (Dokploy will run `docker build` automatically) and set `PORT=3000` env var.
4. Expose port 3000 on the Dokploy service and enable auto-redeploy on push if desired.

The Dockerfile uses the official Bun image, so Dokploy just needs standard Docker support—no custom scripts required.

## Related tooling
- `../benchmark/` — load/soak tests powered by Locust.
- `../deploy/dokploy/` — declarative Dokploy template + instructions for auto deploy on git push.
- `../endpoint/` — CLI harness mirroring client behavior; great for smoke tests during CI/CD.
