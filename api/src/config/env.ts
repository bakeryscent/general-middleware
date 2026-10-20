import { readFileSync } from "node:fs";
const toNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const trimOrUndefined = (value?: string | null): string | undefined =>
  value?.trim() || undefined;

const sanitizeUrl = (value: string | undefined, fallback: string): string =>
  (value ?? fallback).replace(/\/+$/, "");

const trimOrDefault = (value: string | undefined, fallback: string): string =>
  value?.trim() || fallback;

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

const DEVICECHECK_BASE_URL = (Bun.env.NODE_ENV ?? "development") === "production"
  ? "https://api.devicecheck.apple.com/v1"
  : "https://api.development.devicecheck.apple.com/v1";

// Highest numbered account read from the environment (DEVICECHECK_9_*).
const DEVICECHECK_MAX_ACCOUNTS = 9;

export type DeviceCheckEnvConfig = {
  /** Env prefix this account was read from, e.g. "DEVICECHECK_3". */
  name: string;
  keyId?: string;
  teamId?: string;
  privateKey?: string;
  baseUrl: string;
  timeoutMs: number;
  /** Lowercased `x-app-id` values routed to this account. Empty on the primary. */
  appIds: string[];
};

const readDeviceCheckAccount = (prefix: string): DeviceCheckEnvConfig => {
  const keyFile = trimOrUndefined(Bun.env[`${prefix}_PRIVATE_KEY_FILE`]);
  return {
    name: prefix,
    keyId: trimOrUndefined(Bun.env[`${prefix}_KEY_ID`]),
    teamId: trimOrUndefined(Bun.env[`${prefix}_TEAM_ID`]),
    privateKey:
      trimOrUndefined(Bun.env[`${prefix}_PRIVATE_KEY`]) ?? readFileFromPath(keyFile),
    baseUrl: DEVICECHECK_BASE_URL,
    timeoutMs: toNumber(Bun.env[`${prefix}_TIMEOUT_MS`], 4000),
    appIds: (Bun.env[`${prefix}_APP_IDS`] ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  };
};

/**
 * The primary account (DEVICECHECK_*) validates every app that no other account claims.
 * DEVICECHECK_2_* … DEVICECHECK_9_* each serve the apps listed in their `_APP_IDS`
 * (one per Apple team). An extra account is read when any of its variables is set,
 * and then must be complete, or the server refuses to start: a half-configured team
 * would otherwise silently fall back to the primary key and Apple would reject
 * every token from that team's apps.
 */
const readDeviceCheckAccounts = (): [DeviceCheckEnvConfig, ...DeviceCheckEnvConfig[]] => {
  const primary = readDeviceCheckAccount("DEVICECHECK");
  if (primary.appIds.length) {
    throw new Error("DEVICECHECK_APP_IDS is not supported: the primary account serves every unclaimed app");
  }

  const accounts: [DeviceCheckEnvConfig, ...DeviceCheckEnvConfig[]] = [primary];
  const claimedBy = new Map<string, string>();

  for (let n = 2; n <= DEVICECHECK_MAX_ACCOUNTS; n++) {
    const prefix = `DEVICECHECK_${n}`;
    if (!Object.keys(Bun.env).some((key) => key.startsWith(`${prefix}_`) && trimOrUndefined(Bun.env[key]))) {
      continue;
    }

    const account = readDeviceCheckAccount(prefix);
    const missing = [
      !account.keyId && `${prefix}_KEY_ID`,
      !account.teamId && `${prefix}_TEAM_ID`,
      !account.privateKey && `${prefix}_PRIVATE_KEY`,
    ].filter(Boolean);
    if (missing.length) {
      throw new Error(`Incomplete DeviceCheck account ${prefix}, missing: ${missing.join(", ")}`);
    }

    if (!account.appIds.length) {
      console.warn(`DeviceCheck account ${prefix} has no ${prefix}_APP_IDS, so no app is routed to it`);
    }

    for (const appId of account.appIds) {
      const other = claimedBy.get(appId);
      if (other) {
        throw new Error(`App id ${appId} is listed in both ${other}_APP_IDS and ${prefix}_APP_IDS`);
      }
      claimedBy.set(appId, prefix);
    }

    accounts.push(account);
  }

  return accounts;
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
  deviceCheckAccounts: readDeviceCheckAccounts(),
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
    humanizeModel: trimOrDefault(
      Bun.env.HUMANIZER_HUMANIZE_MODEL,
      "ft:gpt-4.1-nano-2025-04-14:bakery-scent-srl:text-humanizer-08-12-2025:CkToTSkg"
    ),
    detectModel: trimOrDefault(
      Bun.env.HUMANIZER_DETECT_MODEL,
      "ft:gpt-4.1-nano-2025-04-14:bakery-scent-srl:ai-text-analyze-08-12-2025:CkUmccaE"
    ),
  },
} as const;

export type ProviderConfigMap = typeof env.providers;
export type OpenAiEnvConfig = ProviderConfigMap["openai"];
export type ClaudeEnvConfig = ProviderConfigMap["claude"];
export type GeminiEnvConfig = ProviderConfigMap["gemini"];
export type AxiomEnvConfig = typeof env.axiom;
export type HumanizerEnvConfig = typeof env.humanizer;
