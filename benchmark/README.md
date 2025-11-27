# Middleware Benchmark Suite

This folder mirrors the `tts_api/benchmark` layout and provides a starting point for exercising the middleware API at scale.

## Requirements
- Python 3.11+
- `pip install -r requirements.txt`

## Usage
```bash
cd benchmark
# Start middleware/api locally or point LOCUST_HOST to your Dokploy URL
export LOCUST_HOST=${LOCUST_HOST:-http://localhost:3000}
locust -f locustfile.py --host "$LOCUST_HOST"
```

The default tasks:
- `GET /api/ping` (3x weight)
- `POST /api/echo` (1x weight, customizable payload)

Adjust weights or add additional tasks as you wire new downstream services. For fully scripted load runs (CI), consider `locust -f locustfile.py --headless -u 10 -r 2 -t 5m`.
