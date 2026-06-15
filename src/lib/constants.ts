// Constantes compartilhadas. Centralizado pra evitar duplicacao entre
// ReplyCard, Dashboard, AdminPanel.

import type { ValueCategory } from "./types";

export const CATEGORY_LABELS: Record<ValueCategory | string, string> = {
  dado_concreto: "dado concreto",
  referencia_nominal: "referencia nominal",
  experiencia_builder: "experiencia builder",
  pergunta_especialista: "pergunta especialista",
  info_pratica: "info pratica",
  nomear_fenomeno: "nomear fenomeno",
  caso_concreto: "caso concreto",
  cross_pollination: "cross-pollination",
  update_info: "update info",
};

// Padroes da skill (reply_pattern smallint -> label). Sera atualizado conforme
// a skill evolve. Hoje pattern 0 = dry-run, demais sao definidos pelo prompt.
export const PATTERN_LABELS: Record<number, string> = {
  0: "dry-run",
};

export function categoryLabel(c: string | null | undefined): string {
  if (!c) return "—";
  return CATEGORY_LABELS[c] ?? c;
}
