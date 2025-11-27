import { Elysia } from "elysia";
import { env } from "../config/env";

export const healthRoutes = new Elysia().get("/", () => ({
  status: "ok",
  version: env.version,
  env: env.nodeEnv,
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
}));
