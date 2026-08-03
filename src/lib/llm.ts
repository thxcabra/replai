import { callLLM, type LLMCallResult } from "./reply-core/llm-caller";
import { buildSystemPrompt } from "./skill-prompt";
import type { Config, SkillPayload } from "./types";

export type GenerateRepliesResult = LLMCallResult;

// V6: dispatcher e resolucao de key foram pra reply-core/llm-caller (canal-agnostico).
// Esta funcao continua sendo o entry point do canal X — monta o system prompt
// especifico (SKILL.md generico + voz + basePrompt override do workspace) e
// delega a chamada. LinkedIn tem seu proprio wrapper em channels/linkedin.
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
  const basePromptOverride = config.basePrompt?.trim() || undefined;
  const systemPrompt = buildSystemPrompt(
    voice,
    basePromptOverride,
    config.persona_public_target
  );

  if (voice) {
    console.log(
      `[replai] LLM call com voz (${voice.length} chars), provider=${config.llm_provider}`
    );
  } else {
    console.warn(
      `[replai] LLM call SEM voz configurada - replies vao sair genericas, provider=${config.llm_provider}`
    );
  }

  return callLLM(payload, config, systemPrompt);
}
