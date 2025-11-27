import { parseResponseBody } from "../lib/http";
import { asJsonRecord, type JsonRecord } from "../lib/object";

export interface ProxyResult {
  ok: boolean;
  status: number;
  body: unknown;
  error?: unknown;
}

export abstract class JsonProxyClient {
  protected toJsonRecord(payload?: JsonRecord | unknown): JsonRecord {
    return asJsonRecord(payload);
  }

  protected async execute(url: string | URL, init: RequestInit): Promise<ProxyResult> {
    const response = await fetch(url, init);
    const parsedBody = await parseResponseBody(response);

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        body: parsedBody,
        error: parsedBody,
      };
    }

    return {
      ok: true,
      status: response.status,
      body: parsedBody,
    };
  }
}
