// V6 — Reply pipeline compartilhado: dispatcher LLM cross-canal.
//
// Extraido de llm.ts (canal X) + reply-generator LinkedIn. Ambos duplicavam:
//   - if (provider === "anthropic") { resolve key + callAnthropic } else { callGemini }
//   - Resolucao de key: config.<provider>_api_key.trim() || fallback .env
//   - Fabricacao de ApiError com mensagem por provider
//
// Agora e 1 unica funcao. O caller passa systemPrompt ja montado (via wrapper
// especifico por canal — X usa buildSystemPrompt, LinkedIn usa
// buildLinkedInSystemPrompt).

import { callAnthropic, type LLMCallResult as AnthropicResult } from "../anthropic";
import { ApiError } from "../errors";
import { callGemini, type LLMCallResult as GeminiResult } from "../gemini";
import { ANTHROPIC_API_KEY, GEMINI_API_KEY } from "../keys";
import type { Config, SkillPayload } from "../types";

// Ambos providers retornam a mesma shape. Reexport pra callers.
export type LLMCallResult = AnthropicResult | GeminiResult;

export async function callLLM(
  payload: SkillPayload,
  config: Config,
  systemPrompt: string
): Promise<LLMCallResult> {
  if (config.llm_provider === "anthropic") {
    const key = config.anthropic_api_key.trim() || ANTHROPIC_API_KEY;
    if (!key) {
      throw new ApiError(
        "anthropic",
        "Configure a chave da Anthropic nas configuracoes (console.anthropic.com) ou no .env."
      );
    }
    return callAnthropic(payload, key, config.model, systemPrompt);
  }

  const key = config.gemini_api_key.trim() || GEMINI_API_KEY;
  if (!key) {
    throw new ApiError(
      "gemini",
      "Configure a chave do Gemini nas configuracoes (aistudio.google.com/apikey) ou no .env."
    );
  }
  return callGemini(payload, key, systemPrompt);
}
