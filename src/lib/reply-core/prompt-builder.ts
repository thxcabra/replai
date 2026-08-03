// V6 — Reply pipeline compartilhado: montagem de system prompt cross-canal.
//
// Extraido de skill-prompt.ts (canal X). LinkedIn tem seu proprio wrapper
// (channels/linkedin/reply-generator.ts) que pode consumir este builder pra
// evitar duplicar cache/estrutura. Neste commit so o X passa a usar; LinkedIn
// continua com montagem manual — refactor incremental sem quebrar output.
//
// Esqueleto emitido:
//   ## <title 1>
//
//   <body 1>
//
//   ---
//
//   ## <title 2>
//
//   <body 2>
//
//   ... (divisor entre sections; ultima sem divisor por default)
//
// Cache LRU cross-canal: mesmo prompt (voice, base) gera a mesma string;
// callers passam cacheKey composto. Cap defensivo de PROMPT_CACHE_MAX pra
// nao acumular indefinidamente quando ha muitos workspaces.

export interface PromptSection {
  /** Titulo curto — o builder adiciona `## ` na frente */
  title: string;
  /** Corpo multi-linha (\n interno permitido). Nao inclui titulo nem divisor */
  body: string;
  /**
   * Emite `---` apos essa section. Default: true, exceto na ultima
   * section da lista (ela nunca ganha divisor por default).
   */
  divider?: boolean;
}

const PROMPT_CACHE = new Map<string, string>();
const PROMPT_CACHE_MAX = 16;

export function buildBasePrompt(args: {
  sections: PromptSection[];
  cacheKey?: string;
}): string {
  if (args.cacheKey) {
    const hit = PROMPT_CACHE.get(args.cacheKey);
    if (hit) return hit;
  }

  const parts: string[] = [];
  for (let i = 0; i < args.sections.length; i++) {
    const s = args.sections[i];
    const isLast = i === args.sections.length - 1;
    const divider = s.divider ?? !isLast;
    parts.push(`## ${s.title}`, "", s.body);
    if (divider) parts.push("", "---", "");
  }
  const result = parts.join("\n");

  if (args.cacheKey) {
    if (PROMPT_CACHE.size >= PROMPT_CACHE_MAX) {
      const first = PROMPT_CACHE.keys().next().value;
      if (first !== undefined) PROMPT_CACHE.delete(first);
    }
    PROMPT_CACHE.set(args.cacheKey, result);
  }
  return result;
}

// Test-only escape hatch (nao usado em runtime). Deixa reset entre snapshots.
export function _resetPromptCache(): void {
  PROMPT_CACHE.clear();
}
