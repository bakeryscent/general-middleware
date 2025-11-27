import { env, type OpenAiEnvConfig } from "../config/env";
import { JsonProxyClient, type ProxyResult } from "./proxy-client";
import type { ProviderProxyRequest } from "../types/provider";

export interface OpenAiProxyRequest extends ProviderProxyRequest {}

export class OpenAiClient extends JsonProxyClient {
  private readonly apiKey?: string;
  private readonly orgId?: string;
  private readonly baseUrl: string;

  constructor(config: OpenAiEnvConfig) {
    super();
    this.apiKey = config.apiKey;
    this.orgId = config.orgId;
    this.baseUrl = config.baseUrl;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  proxy(request: OpenAiProxyRequest): Promise<ProxyResult> {
    const targetPath = this.normalizePath(request.path);
    const payload = this.buildPayload(request);

    return this.execute(`${this.baseUrl}/${targetPath}`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(payload),
    });
  }

  private buildHeaders(): Record<string, string> {
    if (!this.apiKey) {
      throw new Error("OpenAI API key is not configured");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };

    if (this.orgId) {
      headers["OpenAI-Organization"] = this.orgId;
    }

    return headers;
  }

  private buildPayload(request: OpenAiProxyRequest) {
    return {
      ...this.toJsonRecord(request.payload),
      model: request.model,
    };
  }

  private normalizePath(path?: string): string {
    return path?.trim()?.replace(/^\/+/, "") || "responses";
  }
}

export const openAiClient = new OpenAiClient(env.providers.openai);
