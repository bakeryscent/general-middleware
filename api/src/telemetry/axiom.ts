import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { env, type AxiomEnvConfig } from "../config/env";

const buildTraceUrl = (config: AxiomEnvConfig) => `${config.baseUrl}/v1/traces`;

export const createAxiomTraceExporter = () => {
  const config = env.axiom;

  if (!config.token || !config.dataset) {
    return undefined;
  }

  const exporter = new OTLPTraceExporter({
    url: buildTraceUrl(config),
    headers: {
      Authorization: `Bearer ${config.token}`,
      "X-Axiom-Dataset": config.dataset,
    },
  });

  console.info("telemetry.axiom.enabled", {
    dataset: config.dataset,
    url: buildTraceUrl(config),
  });

  return exporter;
};
