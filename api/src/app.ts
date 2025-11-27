import { Elysia } from "elysia";
import { opentelemetry } from "@elysiajs/opentelemetry";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { apiRoutes } from "./routes/api";
import { healthRoutes } from "./routes/health";
import { env } from "./config/env";
import { jsonError } from "./lib/http";
import { DeviceCheckError, validateDeviceCheckToken } from "./lib/devicecheck";

const DEVICECHECK_HEADER = "x-devicecheck-token";

export const createApp = () =>
  new Elysia({ normalize: true })
    .use(
      opentelemetry({
        serviceName: env.telemetryServiceName,
        resource: resourceFromAttributes({
          "service.instance.id": env.instanceId,
        }),
      })
    )
    .onBeforeHandle(async ({ request }) => {
      const token = request.headers.get(DEVICECHECK_HEADER);

      if (!token) {
        console.warn("DeviceCheck missing", {
          path: new URL(request.url).pathname,
        });
        throw jsonError(401, {
          message: "DeviceCheck token is required",
          header: DEVICECHECK_HEADER,
        });
      }

      try {
        await validateDeviceCheckToken(token);
      } catch (error) {
        if (error instanceof DeviceCheckError) {
          console.warn("DeviceCheck rejected", {
            path: new URL(request.url).pathname,
            status: error.status,
            details: error.details,
          });
          throw jsonError(error.status, {
            message: error.message,
            details: error.details,
          });
        }

        throw error;
      }
    })
    .use(healthRoutes)
    .use(apiRoutes);
