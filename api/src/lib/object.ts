export type JsonRecord = Record<string, unknown>;

export const asJsonRecord = (value?: JsonRecord | unknown): JsonRecord => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }

  return {};
};
