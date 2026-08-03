// V6 — Reply pipeline compartilhado: tracking de custo LLM cross-canal.
//
// Encapsula os 3 passos que se repetiam em cada callsite LLM:
//   1. estimateCost (usa PRICING de cost-calc)
//   2. recordLLM (session_logs, no-op se sessionId null)
//   3. track("llm_called") (metrics events)
//
// Ganho principal:
//   - LinkedIn agora tem cost_usd real (antes era hardcoded null em
//     linkedin_replies.llm_cost_usd) sem precisar duplicar codigo.
//   - Quick-test do X passa a rastrear cost_usd/tokens completos (antes
//     so track sem cost, inconsistente com generateRepliesForSelected).
//   - 1 unica fonte de verdade pra formato do event "llm_called".

import type { Channel } from "../channels/types";
import { estimateCost } from "../cost-calc";
import { track } from "../metrics";
import { recordLLM, type SessionId } from "../session-tracking";
import type { ProviderName } from "../types";

// Origem da chamada LLM. Vira o campo `source` no event "llm_called"
// (analytics) e distingue custos em Dashboard/AdminPanel.
export type LLMCallSource =
  | "triage_selected"
  | "regenerate"
  | "quick_test"
  | "linkedin_reply";

export interface TrackLLMCallArgs {
  sessionId: SessionId;
  workspaceId: string;
  channel: Channel;
  provider: ProviderName;
  model: string;
  ms: number;
  usage: {
    input_tokens: number | null;
    output_tokens: number | null;
  };
  itemsIn: number;
  resultsOut: number;
  hasVoice: boolean;
  source: LLMCallSource;
}

export interface TrackLLMCallResult {
  cost_usd: number | null;
}

export async function trackLLMCall(
  args: TrackLLMCallArgs
): Promise<TrackLLMCallResult> {
  const cost = estimateCost(
    args.provider,
    args.model,
    args.usage.input_tokens,
    args.usage.output_tokens
  );

  await recordLLM(args.sessionId, {
    provider: args.provider,
    model: args.model,
    ms: args.ms,
    input_tokens: args.usage.input_tokens,
    output_tokens: args.usage.output_tokens,
    cost_usd: cost,
    replies_generated: args.resultsOut,
  });

  track(
    "llm_called",
    {
      channel: args.channel,
      provider: args.provider,
      model: args.model,
      ms: args.ms,
      tweets_in: args.itemsIn,
      results: args.resultsOut,
      has_voice: args.hasVoice,
      source: args.source,
      input_tokens: args.usage.input_tokens,
      output_tokens: args.usage.output_tokens,
      cost_usd: cost,
    },
    args.workspaceId
  );

  return { cost_usd: cost };
}
