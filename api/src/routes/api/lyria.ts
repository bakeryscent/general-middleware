import { Elysia, t } from "elysia";
import { env } from "../../config/env";
import { jsonError } from "../../lib/http";
import { recordSpanException } from "../../telemetry/span";

const lyriaRequestSchema = t.Object({
  prompt: t.String({ minLength: 1 }),
  genres: t.Array(t.String(), { minItems: 1 }),
  duration: t.Number({ minimum: 30, maximum: 300 }),
  instrumental: t.Optional(t.Boolean()),
});

type LyriaRequestBody = {
  prompt: string;
  genres: string[];
  duration: number;
  instrumental?: boolean;
};

const selectModel = (duration: number) =>
  duration <= 30 ? "lyria-3-clip-preview" : "lyria-3-pro-preview";

const buildPrompt = (body: LyriaRequestBody): string => {
  const parts: string[] = [];

  const instrumental = body.instrumental !== false;

  if (body.duration > 30) {
    parts.push(`Create a ${body.duration}-second`);
  } else {
    parts.push("Create a 30-second");
  }

  if (instrumental) {
    parts.push("instrumental");
  }

  parts.push(`${body.genres.join(", ")} beat.`);

  if (instrumental) {
    parts.push("No vocals.");
  }

  parts.push(body.prompt);

  return parts.join(" ");
};

export const lyriaRoutes = new Elysia({ prefix: "/lyria" }).post(
  "/generate",
  async ({ body }) => {
    const apiKey = env.providers.gemini.apiKey;

    if (!apiKey) {
      throw jsonError(500, {
        message: "GEMINI_API_KEY is not configured on the server",
      });
    }

    const model = selectModel(body.duration);
    const prompt = buildPrompt(body as LyriaRequestBody);
    const useWav = body.duration > 30;

    const geminiUrl = new URL(
      `${env.providers.gemini.baseUrl}/models/${model}:generateContent`
    );
    geminiUrl.searchParams.set("key", apiKey);

    const geminiBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        response_modalities: ["AUDIO", "TEXT"],
      },
    };

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "No response body");
      recordSpanException(`Lyria generation failed: ${response.status}`, {
        "lyria.status": response.status,
        "lyria.model": model,
        "lyria.error": errorBody,
      });
      throw jsonError(response.status >= 500 ? 502 : response.status, {
        message: "Lyria music generation failed",
        details: errorBody,
      });
    }

    const result = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
            inlineData?: { mimeType: string; data: string };
          }>;
        };
      }>;
    };

    const parts = result.candidates?.[0]?.content?.parts;
    if (!parts?.length) {
      throw jsonError(502, {
        message: "Lyria returned an empty response",
      });
    }

    let audio: string | undefined;
    let mimeType = useWav ? "audio/wav" : "audio/mp3";
    const lyrics: string[] = [];

    for (const part of parts) {
      if (part.inlineData) {
        audio = part.inlineData.data;
        mimeType = part.inlineData.mimeType || mimeType;
      } else if (part.text) {
        lyrics.push(part.text);
      }
    }

    if (!audio) {
      throw jsonError(502, {
        message: "Lyria did not return audio data",
      });
    }

    return {
      audio,
      mimeType,
      lyrics: lyrics.join("\n") || null,
      model,
    };
  },
  { body: lyriaRequestSchema }
);
