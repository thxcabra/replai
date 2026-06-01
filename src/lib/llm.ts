import { callAnthropic } from "./anthropic";
import { ApiError } from "./errors";
import { callGemini } from "./gemini";
import { ANTHROPIC_API_KEY, GEMINI_API_KEY } from "./keys";
import type { Config, SkillOutput, SkillPayload } from "./types";

// Ponto unico de chamada de LLM: escolhe o provider ativo (config.llm_provider).
// A chave da UI (config) tem prioridade; se vazia, cai no fallback do .env (keys.ts).
export async function generateReplies(
  payload: SkillPayload,
  config: Config
): Promise<SkillOutput> {
  if (config.llm_provider === "anthropic") {
    const key = config.anthropic_api_key.trim() || ANTHROPIC_API_KEY;
    if (!key) {
      throw new ApiError(
        "anthropic",
        "Configure a chave da Anthropic nas configuracoes (console.anthropic.com) ou no .env."
      );
    }
    return callAnthropic(payload, key, config.model);
  }

  // default: gemini
  const key = config.gemini_api_key.trim() || GEMINI_API_KEY;
  if (!key) {
    throw new ApiError(
      "gemini",
      "Configure a chave do Gemini nas configuracoes (aistudio.google.com/apikey) ou no .env."
    );
  }
  return callGemini(payload, key);
}
