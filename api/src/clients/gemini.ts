import { env, type GeminiEnvConfig } from "../config/env";
import { JsonProxyClient, type ProxyResult } from "./proxy-client";
import type { ProviderProxyRequest } from "../types/provider";

export interface GeminiProxyRequest extends ProviderProxyRequest {}

export class GeminiClient extends JsonProxyClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly defaultAction: string;

  constructor(config: GeminiEnvConfig) {
    super();
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.defaultAction = config.defaultAction;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  proxy(request: GeminiProxyRequest): Promise<ProxyResult> {
    const targetPath = this.normalizePath(request);
    const payload = this.buildPayload(request);
    const url = new URL(`${this.baseUrl}/${targetPath}`);

    url.searchParams.set("key", this.requireApiKey());

    return this.execute(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }

  private requireApiKey(): string {
    if (!this.apiKey) {
      throw new Error("Gemini API key is not configured");
    }

    return this.apiKey;
  }

  private buildPayload(request: GeminiProxyRequest) {
    const payload = this.toJsonRecord(request.payload);

    if (!payload.model) {
      payload.model = this.normalizeModel(request.model);
    }

    return payload;
  }

  private normalizeModel(model: string): string {
    const trimmed = model.trim();
    if (trimmed.startsWith("models/")) {
      return trimmed;
    }
    return `models/${trimmed}`;
  }

  private normalizePath(request: GeminiProxyRequest): string {
    const path = request.path?.trim()?.replace(/^\/+/, "");

    if (path) {
      return path;
    }

    const normalizedModel = this.normalizeModel(request.model);
    return `${normalizedModel}:${this.defaultAction}`;
  }
}

export const geminiClient = new GeminiClient(env.providers.gemini);
