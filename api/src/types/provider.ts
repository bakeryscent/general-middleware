import type { JsonRecord } from "../lib/object";

export interface ProviderProxyRequest {
  model: string;
  path?: string;
  payload?: JsonRecord;
}
