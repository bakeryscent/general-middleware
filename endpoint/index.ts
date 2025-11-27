#!/usr/bin/env bun
import { parseArgs } from "node:util";

const {
  values: { url = "http://localhost:3000", message = "Hello from endpoint", path = "/api/echo" },
} = parseArgs({
  options: {
    url: { type: "string" },
    message: { type: "string" },
    path: { type: "string" },
  },
});

const target = new URL(path, url);

const start = performance.now();
const res = await fetch(target, {
  method: path.endsWith("/echo") ? "POST" : "GET",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message }),
});

const elapsed = performance.now() - start;
const body = await res.text();

console.log(`→ ${target.toString()} [${res.status}] (${elapsed.toFixed(1)}ms)`);
console.log(body);

if (!res.ok) {
  process.exitCode = 1;
}
