import { Elysia, t } from "elysia";
import { jsonError } from "../../lib/http";
import { openAiClient } from "../../clients/openai";
import type { ProxyResult } from "../../clients/proxy-client";
import { recordSpanException } from "../../telemetry/span";

const MODEL = "gpt-5-nano";

const DETECT_PROMPT = `Analyze the following text and determine the probability that it was written by an AI.
Return ONLY a number between 0 and 100 representing the percentage probability.
Do not include any other text or symbols.

Text:
{{TEXT}}`;

const HUMANIZE_PROMPT = `Rewrite the following text to make it sound more human, natural, and engaging.
IMPORTANT: Return ONLY the rewritten text. Do not include any conversational filler like "Here is the text" or "Alright".

Text:
{{TEXT}}`;

// Body schema: { text: string }
const humanizerBodySchema = t.Object({
  text: t.String({ minLength: 1 }),
});

const ensureOpenAiReady = () => {
  if (!openAiClient.isConfigured()) {
    recordSpanException("OpenAI client not configured");
    return jsonError(500, {
      message: "OpenAI is not configured",
    });
  }

  return undefined;
};

const renderPrompt = (template: string, text: string) =>
  template.replace("{{TEXT}}", text);

/**
 * Extracts text from Responses API or fallback Chat response.
 */
const extractText = (result: ProxyResult): string => {
  const raw = result.body as any;

  // Sometimes proxy returns raw text
  if (typeof raw === "string") {
    return raw.trim();
  }

  // Helper: unwrap nested containers like { response: { ... } } or { data: { ... } }
  const unwrapResponse = (obj: any): any => {
    if (!obj || typeof obj !== "object") return obj;

    // Already looks like a Responses object
    if (obj.object === "response" && Array.isArray(obj.output)) {
      return obj;
    }

    if (obj.response && typeof obj.response === "object") {
      return unwrapResponse(obj.response);
    }

    if (obj.data && typeof obj.data === "object") {
      return unwrapResponse(obj.data);
    }

    return obj;
  };

  const body = unwrapResponse(raw);

  if (!body || typeof body !== "object") {
    throw new Error(
      "Unable to extract text from OpenAI response: non-object body " +
        JSON.stringify(body).slice(0, 500)
    );
  }

  //
  // 1) Try convenience `output_text` if present
  //
  const maybeOutputText = (body as any).output_text;
  if (typeof maybeOutputText === "string" && maybeOutputText.trim().length > 0) {
    return maybeOutputText.trim();
  }
  if (Array.isArray(maybeOutputText)) {
    const joined = maybeOutputText
      .filter((p) => typeof p === "string")
      .join("")
      .trim();
    if (joined.length > 0) return joined;
  }

  //
  // 2) Standard Responses API: output[*].content[*].text
  //
  const output = (body as any).output;
  if (Array.isArray(output)) {
    const pieces: string[] = [];

    for (const item of output) {
      const contents = (item as any)?.content;
      if (!Array.isArray(contents)) continue;

      for (const part of contents) {
        if (typeof part?.text === "string") {
          pieces.push(part.text);
        }
      }
    }

    if (pieces.length > 0) {
      return pieces.join("").trim();
    }
  }

  //
  // 3) Fallback: simple `text` field
  //
  if (typeof (body as any).text === "string" && (body as any).text.trim().length > 0) {
    return (body as any).text.trim();
  }

  // Final safety: log shape for debugging
  throw new Error(
    "Unable to extract text from OpenAI response: " +
      JSON.stringify(body).slice(0, 500)
  );
};

type HumanizerAction = "detect" | "humanize";

type OpenAiCallResult = { value: string } | { error: Response };

/**
 * Calls OpenAI Responses API with message-style `input_text`.
 */
const callOpenAi = async (
  text: string,
  template: string,
  action: HumanizerAction
): Promise<OpenAiCallResult> => {
  const configError = ensureOpenAiReady();
  if (configError) {
    return { error: configError };
  }

  const prompt = renderPrompt(template, text);

  console.info("humanizer.openai.request", {
    action,
    length: prompt.length,
  });

  try {
    const payload = {
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt,
            },
          ],
        },
      ],
    };

    console.info(
      "humanizer.openai.payload",
      JSON.stringify(payload, null, 2)
    );

    const result = await openAiClient.proxy({
      model: MODEL,
      payload,
    });

    if (!result.ok) {
      console.error("humanizer.openai.error", {
        action,
        status: result.status,
        details: result.error,
      });

      recordSpanException("OpenAI request failed", {
        "openai.status": result.status,
        "openai.action": action,
      });

      return {
        error: jsonError(result.status, {
          message: "OpenAI request failed",
          details: result.error,
        }),
      };
    }

    const textResult = extractText(result);

    console.info("humanizer.openai.success", {
      action,
      status: result.status,
    });

    return { value: textResult };
  } catch (error) {
    console.error("humanizer.openai.exception", {
      action,
      error,
    });

    recordSpanException(error, {
      "openai.action": action,
    });

    return {
      error: jsonError(502, {
        message: "OpenAI request failed",
        details: error instanceof Error ? error.message : error,
      }),
    };
  }
};

/**
 * Parses a probability returned by detect endpoint.
 */
const parseProbability = (
  value: string
): { value: number } | { error: Response } => {
  const match = value.trim().match(/-?\d+(?:\.\d+)?/);
  const numeric = match ? Number(match[0]) : Number.NaN;

  if (!Number.isFinite(numeric)) {
    recordSpanException("OpenAI did not return a numeric probability", {
      "humanizer.output": value,
    });

    return {
      error: jsonError(502, {
        message: "OpenAI did not return a numeric probability",
        details: value,
      }),
    };
  }

  return {
    value: Math.min(100, Math.max(0, Math.round(numeric))),
  };
};

/**
 * Routes
 */
export const humanizerRoutes = new Elysia({ prefix: "/humanizer" })
  .post(
    "/detect",
    async ({ body }) => {
      console.info("humanizer.detect.request", {
        length: body.text.length,
      });

      const result = await callOpenAi(body.text, DETECT_PROMPT, "detect");

      if ("error" in result) {
        return result.error;
      }

      const parsed = parseProbability(result.value);

      if ("error" in parsed) {
        return parsed.error;
      }

      // Just return the numeric probability as JSON (e.g. 73)
      return parsed.value;
    },
    {
      body: humanizerBodySchema,
    }
  )
  .post(
    "/humanize",
    async ({ body }) => {
      console.info("humanizer.humanize.request", {
        length: body.text.length,
      });

      const result = await callOpenAi(body.text, HUMANIZE_PROMPT, "humanize");

      if ("error" in result) {
        return result.error;
      }

      // Return the rewritten text
      return result.value;
    },
    {
      body: humanizerBodySchema,
    }
  );
