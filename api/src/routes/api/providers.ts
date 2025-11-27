import { Elysia } from "elysia";
import { jsonError } from "../../lib/http";
import { providerRequestSchema, type ProviderRequestBody } from "./schemas";
import { openAiClient } from "../../clients/openai";
import { claudeClient } from "../../clients/claude";
import { geminiClient } from "../../clients/gemini";
import type { ProxyResult } from "../../clients/proxy-client";

interface ProviderRouteDefinition {
  path: string;
  missingConfigMessage: string;
  failureMessage: string;
  isConfigured: () => boolean;
  proxy: (body: ProviderRequestBody) => Promise<ProxyResult>;
}

const providerDefinitions: ProviderRouteDefinition[] = [
  {
    path: "/openai",
    missingConfigMessage: "OPENAI_API_KEY is not configured on the server",
    failureMessage: "OpenAI request failed",
    isConfigured: () => openAiClient.isConfigured(),
    proxy: (body) => openAiClient.proxy(body),
  },
  {
    path: "/claude",
    missingConfigMessage: "CLAUDE_API_KEY (or ANTHROPIC_API_KEY) is not configured on the server",
    failureMessage: "Claude request failed",
    isConfigured: () => claudeClient.isConfigured(),
    proxy: (body) => claudeClient.proxy(body),
  },
  {
    path: "/gemini",
    missingConfigMessage: "GEMINI_API_KEY (or GOOGLE_API_KEY) is not configured on the server",
    failureMessage: "Gemini request failed",
    isConfigured: () => geminiClient.isConfigured(),
    proxy: (body) => geminiClient.proxy(body),
  },
];

export const providerRoutes = providerDefinitions.reduce((router, definition) => {
  return router.post(
    definition.path,
    async ({ body }) => {
      if (!definition.isConfigured()) {
        throw jsonError(500, {
          message: definition.missingConfigMessage,
        });
      }

      const result = await definition.proxy(body as ProviderRequestBody);

      if (!result.ok) {
        throw jsonError(result.status, {
          message: definition.failureMessage,
          details: result.error,
        });
      }

      return result.body;
    },
    {
      body: providerRequestSchema,
    }
  );
}, new Elysia());
