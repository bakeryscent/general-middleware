import { SignJWT, importPKCS8, type KeyLike } from "jose";
import { env, type DeviceCheckEnvConfig } from "../config/env";

const DEVICECHECK_AUDIENCE = "devicecheck.apple.com";
const AUTH_TOKEN_TTL_SECONDS = 20 * 60;
const AUTH_TOKEN_REFRESH_BUFFER_MS = 30_000;

export class DeviceCheckError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "DeviceCheckError";
  }
}

const normalizePrivateKey = (value: string) => value.replace(/\\n/g, "\n");

const assertDeviceCheckConfig = (config: DeviceCheckEnvConfig) => {
  const missing: string[] = [];

  if (!config.keyId) missing.push("DEVICECHECK_KEY_ID");
  if (!config.teamId) missing.push("DEVICECHECK_TEAM_ID");
  if (!config.privateKey) missing.push("DEVICECHECK_PRIVATE_KEY");

  if (missing.length) {
    throw new Error(`Missing DeviceCheck configuration variables: ${missing.join(", ")}`);
  }
};

const buildDeviceCheckUrl = (baseUrl: string, path: string) => `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

class DeviceCheckClient {
  private signingKeyPromise?: Promise<KeyLike>;
  private cachedAuthToken?: { value: string; expiresAt: number };
  private readonly normalizedPrivateKey: string;

  constructor(private readonly config: DeviceCheckEnvConfig) {
    assertDeviceCheckConfig(config);
    this.normalizedPrivateKey = normalizePrivateKey(config.privateKey!);
  }

  private async getSigningKey(): Promise<KeyLike> {
    if (!this.signingKeyPromise) {
      this.signingKeyPromise = importPKCS8(this.normalizedPrivateKey, "ES256");
    }

    return this.signingKeyPromise;
  }

  private async getAuthorizationToken() {
    const now = Date.now();

    if (this.cachedAuthToken && this.cachedAuthToken.expiresAt > now) {
      return this.cachedAuthToken.value;
    }

    const iat = Math.floor(now / 1000);
    const exp = iat + AUTH_TOKEN_TTL_SECONDS;

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: this.config.keyId })
      .setIssuer(this.config.teamId!)
      .setAudience(DEVICECHECK_AUDIENCE)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(await this.getSigningKey());

    this.cachedAuthToken = {
      value: token,
      expiresAt: exp * 1000 - AUTH_TOKEN_REFRESH_BUFFER_MS,
    };

    return token;
  }

  private async post(path: string, body: RequestInit["body"], signal: AbortSignal) {
    const response = await fetch(buildDeviceCheckUrl(this.config.baseUrl, path), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await this.getAuthorizationToken()}`,
        "Content-Type": "application/json",
      },
      body,
      signal,
    });

    return response;
  }

  public async validateToken(deviceToken: string) {
    if (!deviceToken) {
      throw new DeviceCheckError("Missing DeviceCheck token", 401);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await this.post(
        "/validate_device_token",
        JSON.stringify({
          device_token: deviceToken,
          transaction_id: crypto.randomUUID(),
          timestamp: Date.now(),
        }),
        controller.signal
      );

      if (!response.ok) {
        const details = await response.text().catch(() => undefined);
        throw new DeviceCheckError(
          response.status === 400 ? "Invalid DeviceCheck token" : "DeviceCheck validation failed",
          response.status,
          details
        );
      }
    } catch (error) {
      if (error instanceof DeviceCheckError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new DeviceCheckError("DeviceCheck validation timed out", 504);
      }

      throw new DeviceCheckError("DeviceCheck validation request failed", 503, error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const deviceCheckClient = new DeviceCheckClient(env.deviceCheck);

export const validateDeviceCheckToken = (deviceToken: string) =>
  deviceCheckClient.validateToken(deviceToken);
