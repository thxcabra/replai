import { callAnthropic, type LLMCallResult as AnthropicResult } from "./anthropic";
import { ApiError } from "./errors";
import { callGemini, type LLMCallResult as GeminiResult } from "./gemini";
import { ANTHROPIC_API_KEY, GEMINI_API_KEY } from "./keys";
import { buildSystemPrompt } from "./skill-prompt";
import type { Config, SkillPayload } from "./types";

export type GenerateRepliesResult = AnthropicResult | GeminiResult;

// Ponto unico de chamada de LLM: escolhe o provider ativo (config.llm_provider),
// monta o system prompt (SKILL.md generico + voz do workspace), valida a chave
// (UI > .env) e chama o provider. Retorna { output, usage } pra que callers
// possam logar tokens/custo em session_logs e reply_logs.
export async function generateReplies(
  payload: SkillPayload,
  config: Config
): Promise<GenerateRepliesResult> {
  // Fallback defensivo: se config.voice estiver vazia mas o workspace foi
  // criado em V3 (config.custom_prompt), usa esse texto. Garante que o LLM
  // sempre receba a voz que o analista configurou.
  const voice =
    config.voice?.trim() ||
    (config as unknown as { custom_prompt?: string }).custom_prompt?.trim() ||
    "";
  const systemPrompt = buildSystemPrompt(voice);

  // log de debug controlado: confirma que a voz esta indo pra LLM
  if (voice) {
    console.log(
      `[replai] LLM call com voz (${voice.length} chars), provider=${config.llm_provider}`
    );
  } else {
    console.warn(
      `[replai] LLM call SEM voz configurada - replies vao sair genericas, provider=${config.llm_provider}`
    );
  }

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

  // default: gemini
  const key = config.gemini_api_key.trim() || GEMINI_API_KEY;
  if (!key) {
    throw new ApiError(
      "gemini",
      "Configure a chave do Gemini nas configuracoes (aistudio.google.com/apikey) ou no .env."
    );
  }
  return callGemini(payload, key, systemPrompt);
}
