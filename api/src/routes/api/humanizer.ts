import { Elysia, t } from "elysia";
import { jsonError } from "../../lib/http";
import { openAiClient } from "../../clients/openai";
import type { ProxyResult } from "../../clients/proxy-client";
import { recordSpanException } from "../../telemetry/span";
import { env } from "../../config/env";

const MODEL = "gpt-5-nano"; // legacy detect model (fallback)
const DETECT_MODEL = env.humanizer.detectModel;
const HUMANIZE_MODEL = env.humanizer.humanizeModel;

const DETECT_PROMPT = `Analyze the following text and estimate the probability (from 0 to 100) that it was written primarily by an AI language model (e.g., GPT-style, Claude-style, Gemini-style, LLaMA-style, or similar) rather than a human.

In your internal reasoning (which you should NOT output), consider:
- Stylistic “smoothness” and consistency (few typos, uniformly polished sentences).
- Repetitive patterns, generic phrasing, and over-explaining simple concepts.
- Lack of specific, verifiable personal experiences or concrete details.
- Overly balanced, hedged, or neutral tone across the entire text.
- Logical consistency vs. subtle human-like contradictions or idiosyncrasies.
- Whether the text seems stitched together from known AI tropes or stock phrases.
- Whether the text appears partially AI-written (mixed human + AI): in that case, output an intermediate probability.

Your final answer must follow these constraints:
- Return ONLY a number between 0 and 100 representing the percentage probability that the text was written by an AI.
- Do not include any other text or symbols.

Text:
{{TEXT}}`;

const HUMANIZE_PROMPT = `Rewrite the following text to make it sound more human, natural, and engaging, as if it were written by a real person for other real people. You MUST keep the same language (e.g., if the text is in Italian, respond in Italian; if it is in English, respond in English; etc.).

In your internal reasoning (which you should NOT output), consider:
- Keeping the original meaning, intent, and key information intact.
- Using natural, conversational phrasing (including contractions where appropriate).
- Varying sentence length and rhythm (mix short, punchy sentences with longer, more detailed ones).
- Removing or toning down robotic, overly formal, or repetitive language.
- Avoiding generic AI-like patterns and stock phrases (e.g., “As an AI…”, “In conclusion,” used formulaically, “overall,” “this section will explore…”).
- Adding subtle human touches: mild emotion, small asides, or softening phrases where appropriate, without changing the core content.
- Preserving domain-specific terminology and technical accuracy, but explaining dense parts a bit more naturally when needed.
- Maintaining the original language of the text exactly (do NOT translate it).

IMPORTANT OUTPUT CONSTRAINTS:
- Return ONLY the rewritten text.
- Do NOT include any introductory or closing filler such as “Here is the text”, “Sure, here you go:”, or “Alright”.
- Do NOT restate or reference these instructions.
- Do NOT repeat the original text.

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

const logModelUsage = (action: HumanizerAction, model: string) => {
  const isFallback = model === MODEL;
  const mode = isFallback ? "FALLBACK" : "custom";

  const logger = isFallback ? console.warn : console.info;
  logger("humanizer.model", { action, model, mode });
};

/**
 * Calls OpenAI Responses API with message-style `input_text`.
 */
const callOpenAi = async (
  text: string,
  template: string,
  action: HumanizerAction,
  model: string = MODEL,
  payloadOverride?: unknown
): Promise<OpenAiCallResult> => {
  const configError = ensureOpenAiReady();
  if (configError) {
    return { error: configError };
  }

  const prompt = payloadOverride ? "" : renderPrompt(template, text);

  logModelUsage(action, model);

  console.info("humanizer.openai.request", {
    action,
    length: prompt.length,
  });

  try {
    const payload: Record<string, unknown> =
      (payloadOverride as Record<string, unknown>) ?? {
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
      model,
      payload,
    });

    if (!result.ok) {
      const mode = model === MODEL ? "FALLBACK" : "custom";

      console.error("humanizer.openai.error", {
        action,
        status: result.status,
        details: result.error,
        model,
        mode,
      });

      recordSpanException("OpenAI request failed", {
        "openai.status": result.status,
        "openai.action": action,
      });

      return {
        error: jsonError(result.status, {
          message: "OpenAI request failed",
          details: result.error,
          model,
          mode,
        }),
      };
    }

    const textResult = extractText(result);

    console.info("humanizer.openai.success", {
      action,
      status: result.status,
    });

    console.info("humanizer.openai.response", {
      action,
      length: textResult.length,
      preview: textResult.slice(0, 400),
    });

    return { value: textResult };
  } catch (error) {
    const mode = model === MODEL ? "FALLBACK" : "custom";

    console.error("humanizer.openai.exception", {
      action,
      error,
      model,
      mode,
    });

    recordSpanException(error, {
      "openai.action": action,
      "openai.model": model,
      "openai.mode": model === MODEL ? "FALLBACK" : "custom",
    });

    return {
      error: jsonError(502, {
        message: "OpenAI request failed",
        details: error instanceof Error ? error.message : error,
      }),
    };
  }
};

const HUMANIZE_INSTRUCTIONS =
  "You rewrite input text to sound human and always return JSON with 'humanized_text' and 'ai_score'. No extra text.";

const buildHumanizeInput = (text: string) =>
  `Text:\n"""${text}"""\n\nTask: Rewrite the text so it reads as naturally as possible while keeping the same meaning. Then output JSON with keys 'humanized_text' and 'ai_score', where 'ai_score' is a numeric human-likeness score.`;

const DETECT_INSTRUCTIONS =
  "You are a model that scores how likely a text is written by AI. Given a text, you must respond ONLY with its AI score as a number (no words, no symbols, no explanation).";

const buildDetectInput = (text: string) =>
  `Text:\n"""${text}"""\n\nTask: Return ONLY the AI score for this text as a number. Do not add any words or explanation.`;

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
    value: normalizeScore(numeric),
  };
};

const normalizeScore = (value: number): number => {
  const scaled = value <= 1 ? value * 100 : value;
  return Math.min(100, Math.max(0, Math.round(scaled)));
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

      const payload = {
        instructions: DETECT_INSTRUCTIONS,
        input: [
          {
            role: "user",
            content: buildDetectInput(body.text),
          },
        ],
        temperature: 0,
      };

      const result = await callOpenAi(
        body.text,
        DETECT_PROMPT,
        "detect",
        DETECT_MODEL,
        payload
      );

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

      const payload = {
        instructions: HUMANIZE_INSTRUCTIONS,
        input: [
          {
            role: "user",
            content: buildHumanizeInput(body.text),
          },
        ],
        temperature: 0,
      };

      const humanizeResult = await callOpenAi(
        body.text,
        HUMANIZE_PROMPT,
        "humanize",
        HUMANIZE_MODEL,
        payload
      );

      if ("error" in humanizeResult) {
        return humanizeResult.error;
      }

      let rewrittenText = humanizeResult.value;
      let aiScoreFromModel: number | undefined;

      // Attempt to parse JSON returned by the fine-tuned model
      try {
        const parsed = JSON.parse(rewrittenText);
        if (typeof parsed?.humanized_text === "string") {
          rewrittenText = parsed.humanized_text;
        }
        const maybeScore = parsed?.ai_score;
        if (typeof maybeScore === "number") {
          aiScoreFromModel = maybeScore;
        }
      } catch {
        // Ignore parse errors; fall back to existing logic
      }

      if (aiScoreFromModel !== undefined) {
        return {
          text: rewrittenText,
          score: normalizeScore(aiScoreFromModel),
        };
      }

      // Fallback: immediately score the rewritten text using detect prompt
      const scoreResult = await callOpenAi(
        rewrittenText,
        DETECT_PROMPT,
        "detect",
        DETECT_MODEL
      );

      if ("error" in scoreResult) {
        return scoreResult.error;
      }

      const parsedScore = parseProbability(scoreResult.value);

      if ("error" in parsedScore) {
        return parsedScore.error;
      }

      return {
        text: rewrittenText,
        score: parsedScore.value,
      };
    },
    {
      body: humanizerBodySchema,
    }
  );
