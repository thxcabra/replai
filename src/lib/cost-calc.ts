import type { ProviderName } from "./types";

// Calculo de custo LLM client-side. Precos em USD por 1M tokens (input/output).
// Update quando o vendor mexer no pricing. Source:
//   - Anthropic: https://www.anthropic.com/pricing
//   - Gemini: https://ai.google.dev/pricing
//
// Atual em 2026-06.

interface ModelPricing {
  input_per_1m: number;
  output_per_1m: number;
}

const PRICING: Record<string, ModelPricing> = {
  // Anthropic
  "claude-opus-4-7": { input_per_1m: 15, output_per_1m: 75 },
  "claude-opus-4-8": { input_per_1m: 15, output_per_1m: 75 },
  "claude-sonnet-4-6": { input_per_1m: 3, output_per_1m: 15 },
  "claude-haiku-4-5-20251001": { input_per_1m: 1, output_per_1m: 5 },
  "claude-fable-5": { input_per_1m: 3, output_per_1m: 15 },

  // Gemini (Flash tier - default usado pela skill)
  "gemini-2.5-flash": { input_per_1m: 0.075, output_per_1m: 0.3 },
  "gemini-2.5-pro": { input_per_1m: 1.25, output_per_1m: 5 },
};

// Estima custo em USD com 6 casas de precisao (cabe em numeric(10,6)).
// Retorna null se nao conhece o modelo.
export function estimateCost(
  _provider: ProviderName,
  model: string,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined
): number | null {
  if (inputTokens == null || outputTokens == null) return null;
  const pricing = PRICING[model];
  if (!pricing) return null;
  const cost =
    (inputTokens / 1_000_000) * pricing.input_per_1m +
    (outputTokens / 1_000_000) * pricing.output_per_1m;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

// Util pra UI: formata pra exibicao (USD com 4 casas pra valores pequenos).
export function formatCostUsd(cost: number | null | undefined): string {
  if (cost == null) return "—";
  if (cost < 0.0001) return "<$0.0001";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}
