import { ApiError, friendlyHttpMessage } from "./errors";
import { parseSkillOutput } from "./parse-skill";
import { REPLAI_RESPONSE_SCHEMA } from "./replai-schema";
import type { SkillOutput, SkillPayload } from "./types";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

export async function callGemini(
  payload: SkillPayload,
  apiKey: string,
  systemPrompt: string
): Promise<SkillOutput> {
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
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

  return parseSkillOutput(text);
}
