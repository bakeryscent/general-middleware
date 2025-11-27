from locust import HttpUser, task, between
import os

class MiddlewareUser(HttpUser):
    wait_time = between(0.5, 2.0)
    base_path = os.environ.get("MIDDLEWARE_BASE_PATH", "")

    def _url(self, path: str) -> str:
        if self.base_path:
            return f"{self.base_path}{path}"
        return path

    @task(3)
    def ping(self):
        self.client.get(self._url("/api/ping"))

    @task(1)
    def echo(self):
        payload = {"message": "benchmark"}
        self.client.post(self._url("/api/echo"), json=payload)
