import { env, type ClaudeEnvConfig } from "../config/env";
import { JsonProxyClient, type ProxyResult } from "./proxy-client";
import type { ProviderProxyRequest } from "../types/provider";

export interface ClaudeProxyRequest extends ProviderProxyRequest {}

export class ClaudeClient extends JsonProxyClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly beta?: string;

  constructor(config: ClaudeEnvConfig) {
    super();
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.apiVersion = config.apiVersion;
    this.beta = config.beta;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  proxy(request: ClaudeProxyRequest): Promise<ProxyResult> {
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
      throw new Error("Claude API key is not configured");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": this.apiVersion,
    };

    if (this.beta) {
      headers["anthropic-beta"] = this.beta;
    }

    return headers;
  }

  private buildPayload(request: ClaudeProxyRequest) {
    return {
      ...this.toJsonRecord(request.payload),
      model: request.model,
    };
  }

  private normalizePath(path?: string): string {
    return path?.trim()?.replace(/^\/+/, "") || "messages";
  }
}

export const claudeClient = new ClaudeClient(env.providers.claude);
