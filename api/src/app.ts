import { Elysia } from "elysia";
import { opentelemetry } from "@elysiajs/opentelemetry";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { apiRoutes } from "./routes/api";
import { healthRoutes } from "./routes/health";
import { env } from "./config/env";
import { jsonError } from "./lib/http";
import { DeviceCheckError, validateDeviceCheckToken } from "./lib/devicecheck";
import { createAxiomTraceExporter } from "./telemetry/axiom";
import { recordSpanException } from "./telemetry/span";

const DEVICECHECK_HEADER = "x-devicecheck-token";
const axiomTraceExporter = createAxiomTraceExporter();

export const createApp = () =>
  new Elysia({ normalize: true })
    .use(
      opentelemetry({
        serviceName: env.telemetryServiceName,
        resource: resourceFromAttributes({
          "service.instance.id": env.instanceId,
        }),
        ...(axiomTraceExporter && { traceExporter: axiomTraceExporter }),
      })
    )
    .onBeforeHandle(async ({ request }) => {
      const path = new URL(request.url).pathname;
      const token = request.headers.get(DEVICECHECK_HEADER);

      if (!token) {
        console.warn("DeviceCheck missing", { path });
        recordSpanException("Missing DeviceCheck token", {
          "devicecheck.path": path,
        });
        return jsonError(401, {
          message: "DeviceCheck token is required",
          header: DEVICECHECK_HEADER,
        });
      }

      try {
        await validateDeviceCheckToken(token);
      } catch (error) {
        if (error instanceof DeviceCheckError) {
          const logDetails = typeof error.details === "string" ? error.details : JSON.stringify(error.details);

          recordSpanException(error, {
            "devicecheck.path": path,
            "devicecheck.reason": logDetails,
            "devicecheck.status": error.status,
          });

          console.warn("DeviceCheck rejected", {
            path,
            status: error.status,
            reason: logDetails,
          });

          const response = jsonError(error.status, {
            message: error.message,
            reason: logDetails,
          });
          
          // Log the error response we are sending to the client
          console.info("Sending DeviceCheck error response", {
             status: response.status,
             headers: Object.fromEntries(response.headers.entries())
          });

          return response;
        }

        throw error;
      }
    })
    .use(healthRoutes)
    .use(apiRoutes);
