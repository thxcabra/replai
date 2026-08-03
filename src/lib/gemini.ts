import { LIMITS, TIMEOUTS } from "./constants";
import { ApiError, friendlyHttpMessage } from "./errors";
import { parseSkillOutput } from "./parse-skill";
import { REPLAI_RESPONSE_SCHEMA } from "./replai-schema";
import type { SkillOutput, SkillPayload, TweetMedia } from "./types";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// V4.1.14 (IN-01): movido pra LIMITS.MAX_IMAGES_PER_LLM_CALL

// Coleta imagens (photo only — pula video/gif pra Gemini, multimodal nao
// suporta video bem em batch sync) e retorna parts pra prepender no contents.
async function collectImageParts(
  payload: SkillPayload
): Promise<Array<{ inlineData: { mimeType: string; data: string } }>> {
  const tweets = payload.tweets ?? [];
  const parts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
  let count = 0;
  for (const t of tweets) {
    if (count >= LIMITS.MAX_IMAGES_PER_LLM_CALL) break;
    const photos = (t.media ?? []).filter((m) => m.type === "photo");
    for (const m of photos) {
      if (count >= LIMITS.MAX_IMAGES_PER_LLM_CALL) break;
      const part = await fetchImageAsInlineData(m);
      if (part) {
        parts.push(part);
        count += 1;
      }
    }
  }
  return parts;
}

async function fetchImageAsInlineData(
  media: TweetMedia
): Promise<{ inlineData: { mimeType: string; data: string } } | null> {
  // V4.1.14 (WR-03): timeout de IMAGE_FETCH_MS pra evitar fetch hung
  // bloqueando o batch inteiro (TwitterAPI media URLs ocasionalmente travam).
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    TIMEOUTS.IMAGE_FETCH_MS
  );
  try {
    const res = await fetch(media.url, { signal: controller.signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    const mimeType = blob.type || "image/jpeg";
    // Suporta so jpeg/png/webp/heic pelo Gemini
    if (
      !/^image\/(jpeg|jpg|png|webp|heic|heif)$/.test(mimeType.toLowerCase())
    ) {
      return null;
    }
    // V4.1.14 (WR-04): substitui chunked btoa por FileReader.readAsDataURL
    // — funciona pra qualquer tamanho sem risco de stack overflow do spread.
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
    const commaIdx = dataUrl.indexOf(",");
    if (commaIdx < 0) return null;
    const data = dataUrl.slice(commaIdx + 1);
    return {
      inlineData: {
        mimeType,
        data,
      },
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

export interface LLMCallResult {
  output: SkillOutput;
  usage: {
    input_tokens: number | null;
    output_tokens: number | null;
  };
}

export async function callGemini(
  payload: SkillPayload,
  apiKey: string,
  systemPrompt: string
): Promise<LLMCallResult> {
  // V4.1 multimodal: anexa imagens (foto) dos tweets pro Gemini analisar.
  // Best-effort: se fetch da imagem falha, pula. Limit LIMITS.MAX_IMAGES_PER_LLM_CALL.
  const imageParts = await collectImageParts(payload);
  const userParts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [];
  if (imageParts.length > 0) {
    userParts.push({
      text: `[multimodal] ${imageParts.length} imagem(ns) anexadas pros tweets que tem media. Use as imagens pra entender contexto visual; mencione no reply quando relevante.`,
    });
    userParts.push(...imageParts);
  }
  userParts.push({ text: JSON.stringify(payload) });

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: userParts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: REPLAI_RESPONSE_SCHEMA,
      temperature: 0.8,
      maxOutputTokens: 16384,
      // thinking desligado: garante que o budget de output va todo pro JSON
      // (com batch grande, thinking + JSON estourava o teto e truncava).
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  let response: Response;
  try {
    response = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      "gemini",
      "Falha de rede ao chamar o Gemini. Cheque sua conexao."
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      const errJson = (await response.json()) as GeminiResponse;
      if (errJson.error?.message) detail = ` (${errJson.error.message})`;
    } catch {
      /* ignora */
    }
    throw new ApiError(
      "gemini",
      friendlyHttpMessage("gemini", response.status) + detail,
      response.status
    );
  }

  let data: GeminiResponse;
  try {
    data = await response.json();
  } catch {
    throw new ApiError("gemini", "Resposta do Gemini nao e JSON valido.");
  }

  if (data.promptFeedback?.blockReason) {
    throw new ApiError(
      "gemini",
      `O Gemini bloqueou o prompt (${data.promptFeedback.blockReason}).`
    );
  }

  const candidate = data.candidates?.[0];
  if (candidate?.finishReason === "MAX_TOKENS") {
    throw new ApiError(
      "gemini",
      "A resposta do Gemini foi cortada por limite de tokens. Reduza a janela de tempo ou o teto de batch."
    );
  }

  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) {
    throw new ApiError("gemini", "O Gemini devolveu uma resposta vazia.");
  }

  const output = parseSkillOutput(text);
  return {
    output,
    usage: {
      input_tokens: data.usageMetadata?.promptTokenCount ?? null,
      output_tokens: data.usageMetadata?.candidatesTokenCount ?? null,
    },
  };
}
