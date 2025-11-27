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

const renderPrompt = (template: string, text: string) => template.replace("{{TEXT}}", text);

const extractText = (result: ProxyResult) => {
  const body = result.body as Record<string, unknown> | string | undefined;

  if (typeof body === "string") {
    return body.trim();
  }

  if (body && typeof body === "object") {
    const fromOutput = (body as any)?.output;

    if (Array.isArray(fromOutput)) {
      const firstContent = fromOutput[0]?.content;
      if (Array.isArray(firstContent)) {
        const textChunk = firstContent.find((chunk: any) => typeof chunk?.text === "string");
        if (textChunk?.text) {
          return String(textChunk.text).trim();
        }
      }
    }

    const choices = (body as any)?.choices;
    if (Array.isArray(choices)) {
      const choice = choices[0];
      const messageContent = choice?.message?.content;

      if (typeof messageContent === "string") {
        return messageContent.trim();
      }

      if (Array.isArray(messageContent)) {
        const part = messageContent.find((piece: any) => typeof piece?.text === "string");
        if (part?.text) {
          return String(part.text).trim();
        }
      }
    }
  }

  throw new Error("Unable to extract text from OpenAI response");
};

type HumanizerAction = "detect" | "humanize";

type OpenAiCallResult =
  | { value: string }
  | { error: Response };

const callOpenAi = async (text: string, template: string, action: HumanizerAction): Promise<OpenAiCallResult> => {
  const configError = ensureOpenAiReady();
  if (configError) {
    return { error: configError };
  }

  console.info("humanizer.openai.request", {
    action,
    length: text.length,
  });

  try {
    const result = await openAiClient.proxy({
      model: MODEL,
      payload: {
        input: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: renderPrompt(template, text),
              },
            ],
          },
        ],
      },
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

const parseProbability = (value: string): { value: number } | { error: Response } => {
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

export const humanizerRoutes = new Elysia({ prefix: "/humanizer" })
  .post(
    "/detect",
    async ({ body }) => {
      console.info("humanizer.detect.request", { length: body.text.length });
      const result = await callOpenAi(body.text, DETECT_PROMPT, "detect");

      if ("error" in result) {
        return result.error;
      }

      const parsed = parseProbability(result.value);

      if ("error" in parsed) {
        return parsed.error;
      }

      return parsed.value;
    },
    {
      body: humanizerBodySchema,
    }
  )
  .post(
    "/humanize",
    async ({ body }) => {
      console.info("humanizer.humanize.request", { length: body.text.length });
      const result = await callOpenAi(body.text, HUMANIZE_PROMPT, "humanize");

      if ("error" in result) {
        return result.error;
      }

      return result.value;
    },
    {
      body: humanizerBodySchema,
    }
  );
