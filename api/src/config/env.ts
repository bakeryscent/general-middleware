import { readFileSync } from "node:fs";
const toNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const trimOrUndefined = (value?: string | null): string | undefined =>
  value?.trim() || undefined;

const sanitizeUrl = (value: string | undefined, fallback: string): string =>
  (value ?? fallback).replace(/\/+$/, "");

const toHumanizerScoreMode = (value?: string | null) =>
  value?.toLowerCase() === "openai" ? "openai" : "mock";

const readFileFromPath = (path: string | undefined): string | undefined => {
  if (!path) {
    return undefined;
  }

  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Unable to read DeviceCheck key file at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const env = {
  port: toNumber(Bun.env.PORT, 3000),
  nodeEnv: Bun.env.NODE_ENV ?? "development",
  version: Bun.env.APP_VERSION ?? "0.1.0",
  instanceId: Bun.env.INSTANCE_ID ?? "local",
  telemetryServiceName: `middleware-${Bun.env.NODE_ENV ?? "development"}`,
  axiom: {
    token: trimOrUndefined(Bun.env.AXIOM_TOKEN),
    dataset: trimOrUndefined(Bun.env.AXIOM_DATASET),
    baseUrl: sanitizeUrl(Bun.env.AXIOM_BASE_URL, "https://api.axiom.co"),
  },
  deviceCheck: {
    keyId: trimOrUndefined(Bun.env.DEVICECHECK_KEY_ID),
    teamId: trimOrUndefined(Bun.env.DEVICECHECK_TEAM_ID),
    privateKey:
      trimOrUndefined(Bun.env.DEVICECHECK_PRIVATE_KEY) ??
      readFileFromPath(trimOrUndefined(Bun.env.DEVICECHECK_PRIVATE_KEY_FILE)),
    baseUrl: (Bun.env.NODE_ENV ?? "development") === "production"
      ? "https://api.devicecheck.apple.com/v1"
      : "https://api.development.devicecheck.apple.com/v1",
    timeoutMs: toNumber(Bun.env.DEVICECHECK_TIMEOUT_MS, 4000),
  },
  providers: {
    openai: {
      apiKey: trimOrUndefined(Bun.env.OPENAI_API_KEY),
      orgId: trimOrUndefined(Bun.env.OPENAI_ORG_ID),
      baseUrl: sanitizeUrl(Bun.env.OPENAI_BASE_URL, "https://api.openai.com/v1"),
    },
    claude: {
      apiKey: trimOrUndefined(Bun.env.CLAUDE_API_KEY ?? Bun.env.ANTHROPIC_API_KEY),
      baseUrl: sanitizeUrl(Bun.env.CLAUDE_BASE_URL ?? Bun.env.ANTHROPIC_BASE_URL, "https://api.anthropic.com/v1"),
      apiVersion: trimOrUndefined(Bun.env.CLAUDE_API_VERSION ?? Bun.env.ANTHROPIC_API_VERSION) ?? "2023-06-01",
      beta: trimOrUndefined(Bun.env.CLAUDE_BETA ?? Bun.env.ANTHROPIC_BETA),
    },
    gemini: {
      apiKey: trimOrUndefined(Bun.env.GEMINI_API_KEY ?? Bun.env.GOOGLE_API_KEY),
      baseUrl: sanitizeUrl(Bun.env.GEMINI_BASE_URL, "https://generativelanguage.googleapis.com/v1beta"),
      defaultAction: trimOrUndefined(Bun.env.GEMINI_DEFAULT_ACTION) ?? "generateContent",
    },
  },
  humanizer: {
    scoreMode: toHumanizerScoreMode(Bun.env.HUMANIZER_SCORE_MODE),
    mockScoreMin: toNumber(Bun.env.HUMANIZER_MOCK_SCORE_MIN, 10),
    mockScoreMax: toNumber(Bun.env.HUMANIZER_MOCK_SCORE_MAX, 30),
  },
} as const;

export type ProviderConfigMap = typeof env.providers;
export type OpenAiEnvConfig = ProviderConfigMap["openai"];
export type ClaudeEnvConfig = ProviderConfigMap["claude"];
export type GeminiEnvConfig = ProviderConfigMap["gemini"];
export type DeviceCheckEnvConfig = typeof env.deviceCheck;
export type AxiomEnvConfig = typeof env.axiom;
export type HumanizerEnvConfig = typeof env.humanizer;
