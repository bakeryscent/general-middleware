import { Elysia } from "elysia";
import { providerRoutes } from "./providers";
import { echoRequestSchema } from "./schemas";
import { humanizerRoutes } from "./humanizer";

export const apiRoutes = new Elysia({ prefix: "/api" })
  .get("/ping", () => ({ message: "pong" }))
  .post(
    "/echo",
    ({ body }) => ({
      message: body.message,
      receivedAt: new Date().toISOString(),
    }),
    {
      body: echoRequestSchema,
    }
  )
  .use(humanizerRoutes)
  .use(providerRoutes);
