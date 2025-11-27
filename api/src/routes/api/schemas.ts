import { t } from "elysia";

export const echoRequestSchema = t.Object({
  message: t.String({ minLength: 1 }),
});

export const providerRequestSchema = t.Object({
  model: t.String({ minLength: 1 }),
  path: t.Optional(t.String({ minLength: 1 })),
  payload: t.Optional(t.Record(t.String(), t.Unknown())),
});

export type ProviderRequestBody = {
  model: string;
  path?: string;
  payload?: Record<string, unknown>;
};
