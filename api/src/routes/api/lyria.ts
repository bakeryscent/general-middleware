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

// Full-length beats go to Lyria 3.5 (Interactions API). If that call fails
// for any reason the route falls back to Lyria 3 Pro (generateContent), so a
// problem with the new model never takes beat generation down.
const LYRIA_35_MODEL = "lyria-3.5";

const selectModel = (duration: number) =>
  duration <= 30 ? "lyria-3-clip-preview" : "lyria-3-pro-preview";

// Production notes per genre: tempo, drums and sound palette. Vague prompts
// give generic results, so each genre gets the details a producer would use.
const genreStyles: Record<string, string> = {
  "hip hop": "90 BPM boom bap groove, punchy kick and snare, dusty sampled chords, deep bass",
  trap: "140 BPM half-time trap, booming 808 bass, fast hi-hat rolls, crisp claps, dark synth melody",
  drill: "142 BPM drill, sliding 808 glides, syncopated hi-hats and snares, ominous piano or strings",
  phonk: "130 BPM phonk, distorted cowbell melody, heavy 808, Memphis-style vocal-free chops",
  rnb: "75 BPM smooth R&B, warm Rhodes chords, soft snaps, round sub bass",
  pop: "110 BPM modern pop, bright synths, tight drums, catchy instrumental hook",
  "k-pop": "120 BPM K-pop, polished synths, punchy drums, dynamic drops",
  reggaeton: "95 BPM reggaeton dembow rhythm, deep bass, Latin percussion",
  latin: "100 BPM Latin groove, congas, timbales, warm guitar and bass",
  afrobeat: "105 BPM afrobeats, syncopated log drums and shakers, warm plucked guitar, bouncy bass",
  edm: "128 BPM EDM, big supersaw leads, four-on-the-floor kick, build-ups and drops",
  "electronic dance": "126 BPM electronic dance, driving kick, rolling bass, shimmering synths",
  electronic: "120 BPM electronic, layered synths, tight programmed drums",
  clectronic: "120 BPM electronic, layered synths, tight programmed drums",
  house: "124 BPM house, four-on-the-floor kick, offbeat hats, piano stabs, groovy bass",
  "tropical house": "110 BPM tropical house, marimba and pluck melodies, relaxed four-on-the-floor",
  "uk garage": "132 BPM UK garage, shuffled 2-step drums, chopped organ stabs, warm sub bass",
  "drum and bass": "174 BPM drum and bass, fast breakbeats, rolling reese bass",
  rock: "120 BPM rock, live drums, driving electric guitars, bass guitar",
  metal: "150 BPM metal, double-kick drums, heavy distorted guitar riffs",
  indie: "115 BPM indie, jangly guitars, live drums, warm bass",
  funk: "105 BPM funk, slap bass, wah guitar, tight live drums, brass stabs",
  jazz: "90 BPM jazz hip hop, upright bass, brushed drums, jazzy piano chords",
  ambient: "70 BPM ambient, evolving pads, soft textures, subtle pulse",
  country: "100 BPM modern country, acoustic and electric guitars, steady drums",
  reggae: "75 BPM reggae one-drop rhythm, offbeat guitar skank, deep bass",
  world: "100 BPM world fusion, traditional percussion, organic instruments",
};

const buildPrompt = (body: LyriaRequestBody): string => {
  const parts: string[] = [];

  const instrumental = body.instrumental !== false;
  const seconds = body.duration > 30 ? body.duration : 30;

  parts.push(
    `Create a ${seconds}-second ${instrumental ? "instrumental " : ""}${body.genres.join(", ")} beat for a rapper or singer to write and perform over.`
  );

  const styles = body.genres
    .map((genre) => genreStyles[genre.toLowerCase()])
    .filter(Boolean);
  if (styles.length) {
    parts.push(`Production: ${styles.join("; ")}.`);
  }

  parts.push(
    "Structure: short intro, a steady main loop with clear space for vocals, a variation in the middle, and a clean outro. Professional mix, punchy drums, full low end."
  );

  if (instrumental) {
    parts.push("Instrumental only, no vocals, no lyrics, no vocal chops.");
  }

  parts.push(body.prompt);

  return parts.join(" ");
};

type LyriaAudio = { audio: string; mimeType: string; lyrics: string | null; model: string };

type InteractionBlock = {
  type?: string;
  text?: string;
  data?: string;
  mime_type?: string;
  mimeType?: string;
};

// Lyria 3.5 via the Interactions API. Throws on any failure so the caller
// can fall back to Lyria 3.
const generateWithLyria35 = async (prompt: string, apiKey: string): Promise<LyriaAudio> => {
  const response = await fetch(`${env.providers.gemini.baseUrl}/interactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ model: LYRIA_35_MODEL, input: prompt }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "No response body");
    throw new Error(`HTTP ${response.status}: ${errorBody.slice(0, 500)}`);
  }

  const result = (await response.json()) as {
    steps?: Array<{ type?: string; content?: InteractionBlock[] }>;
    outputs?: InteractionBlock[];
  };

  const blocks: InteractionBlock[] = [
    ...(result.steps ?? [])
      .filter((step) => step.type === "model_output")
      .flatMap((step) => step.content ?? []),
    ...(result.outputs ?? []),
  ];

  let audio: string | undefined;
  let mimeType = "audio/mp3";
  const lyrics: string[] = [];

  for (const block of blocks) {
    if (block.type === "audio" && block.data) {
      audio = block.data;
      mimeType = block.mime_type || block.mimeType || mimeType;
    } else if (block.type === "text" && block.text) {
      lyrics.push(block.text);
    }
  }

  if (!audio) {
    throw new Error("no audio in Lyria 3.5 response");
  }

  return { audio, mimeType, lyrics: lyrics.join("\n") || null, model: LYRIA_35_MODEL };
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

    if (body.duration > 30) {
      try {
        return await generateWithLyria35(prompt, apiKey);
      } catch (error) {
        console.warn(`[lyria] Lyria 3.5 failed, falling back to ${model}:`, error);
        recordSpanException(`Lyria 3.5 failed, falling back to ${model}`, {
          "lyria.model": LYRIA_35_MODEL,
          "lyria.error": String(error),
        });
      }
    }

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
        finishReason?: string;
      }>;
      promptFeedback?: {
        blockReason?: string;
        safetyRatings?: Array<{ category: string; probability: string }>;
      };
    };

    const parts = result.candidates?.[0]?.content?.parts;
    if (!parts?.length) {
      const finishReason = result.candidates?.[0]?.finishReason;
      const blockReason = result.promptFeedback?.blockReason;
      throw jsonError(502, {
        message: "Lyria returned an empty response",
        finishReason: finishReason || null,
        blockReason: blockReason || null,
        promptFeedback: result.promptFeedback || null,
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
