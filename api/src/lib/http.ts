import type { JsonRecord } from "./object";

const defaultHeaders = {
  "Content-Type": "application/json",
};

export const jsonResponse = (payload: JsonRecord, init?: ResponseInit) =>
  new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      ...defaultHeaders,
      ...init?.headers,
    },
  });

export const jsonError = (status: number, payload: JsonRecord) =>
  jsonResponse(payload, { status });

export const parseResponseBody = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get("content-type");

  if (contentType?.includes("application/json")) {
    return response.json();
  }

  return response.text();
};
