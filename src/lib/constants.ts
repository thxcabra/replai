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

// V4.1.14 (IN-01): constants compartilhados — antes duplicados em varios
// arquivos como magic numbers. Mudar UM valor aqui propaga pra todo lugar.

export const TIMEOUTS = {
  /** Cooldown entre clicks no botao "atualizar" (anti duplo-click + cota TwitterAPI) */
  REFRESH_COOLDOWN_MS: 30_000,
  /** Timeout por fetch de imagem (Gemini media inline / Watchtower / Unsplash legacy) */
  IMAGE_FETCH_MS: 8_000,
  /** Timeout por chamada de geracao de imagem (LLM total) */
  IMAGE_GEN_MS: 30_000,
  /** Quanto tempo um workspace recem-criado preserva no pullAll merge */
  RECENT_WORKSPACE_WINDOW_MS: 60_000,
  /** "verificada" / "salvo" / "copiado" feedback duration */
  TOAST_FLASH_MS: 1_500,
} as const;

export const TTLS = {
  /** Cache de post analysis (regex + topic detection — barato pra refazer) */
  ANALYSIS_MS: 24 * 60 * 60 * 1000,
  /** Cache de author profile (Supabase query — re-puxa diario) */
  AUTHOR_PROFILE_MS: 60 * 60 * 1000,
  /** Negative cache (resposta NULL) — TTL curto pra permitir retry rapido */
  NEGATIVE_MS: 5 * 60 * 1000,
} as const;

export const LIMITS = {
  /** Twitter/X char limit */
  X_CHAR_LIMIT: 280,
  /** LinkedIn comment char limit (soft — LinkedIn permite 1250 mas tom fica ruim) */
  LINKEDIN_COMMENT_CHAR_LIMIT: 500,
  /** Max imagens enviadas pro LLM por chamada (multimodal limit + custo) */
  MAX_IMAGES_PER_LLM_CALL: 12,
  /** Max imagens cachadas em memoria (cache LRU) — cada uma 200KB-1MB */
  MAX_IMAGE_CACHE: 20,
  /** Max entries no cache de post analysis (chrome.storage.local quota) */
  MAX_ANALYSIS_CACHE: 1000,
  /** Max paginas que fetchListTweets percorre por refresh */
  MAX_TWITTERAPI_PAGES_HARD: 20,
  /** Max tweets enviados pro LLM por batch */
  MAX_LLM_BATCH: 200,
  /** Admin export — max rows por export pra evitar OOM */
  MAX_EXPORT_ROWS: 50_000,
  /** Recent reply categories window pra posts suggestion */
  RECENT_REPLIES_LIMIT: 50,
  /** Top-N virais usados como input pra posts suggestion */
  VIRAL_TOP_N: 15,
  /** Watchtower text max chars enviados pro LLM (evita estourar context) */
  WATCHTOWER_MAX_CHARS: 8000,
} as const;

// ============================================================================
// V5 — LinkedIn / Groundswell / Compliance
// ============================================================================
//
// LINKEDIN COMPLIANCE (rate limits humanoides):
// Padroes muito rapidos = bot detection = ban da conta. Numeros abaixo sao
// calibrados pra "humano ativo": max 15 replies/h por analista, cooldown
// aleatorio 60-180s entre generations (mimick humano lendo o post), max
// 40 replies POSTADAS/dia por workspace. LinkedIn flaga >50/dia.
//
// Estes NAO sao configuraveis por analista — sao floors/ceilings do sistema
// pra proteger a conta. Config.linkedinDailyReplyLimit permite ABAIXAR
// (mais conservador) mas nunca aumentar.

export const LINKEDIN_COMPLIANCE = {
  /** Max replies GERADAS por analista por hora (envelope humano) */
  MAX_GENERATIONS_PER_HOUR: 15,
  /** Max replies POSTADAS por workspace por dia (LinkedIn ban threshold) */
  MAX_POSTS_PER_DAY_HARD: 40,
  /** Default recomendado no Settings — conservador */
  MAX_POSTS_PER_DAY_DEFAULT: 20,
  /** Cooldown minimo entre generations (segundos) — evita ritmo de bot */
  GENERATION_COOLDOWN_MIN_S: 60,
  /** Cooldown maximo — jitter aleatorio 60-180s */
  GENERATION_COOLDOWN_MAX_S: 180,
  /** Janela de "manha ativa" — evita atividade 00-06 madrugada BR */
  ACTIVE_HOURS_LOCAL: { start: 8, end: 23 },
} as const;

// APIFY cost containment (5 camadas do plano V5)
// V5.0.3: apimaestro aceita 1 username/chamada. 1 refresh full = N bridges chamadas.
// Cache-key por-bridge — refresh subsequente com maioria cache hit.
export const APIFY = {
  LINKEDIN_POSTS_ACTOR: "apimaestro/linkedin-profile-posts",
  /** Preço público do actor: US$5 / 1.000 resultados. */
  LINKEDIN_POST_USD: 0.005,
  /** TTL do cache de resultados por (actor_id, input_hash).
   *  V5.3.2: 24h → 72h. Cache mais longo = menos chamadas APIFY em refresh
   *  espontaneo. Trade-off: posts novos podem demorar ate 3 dias pra
   *  aparecer se user nao clicar "forcar refresh" (que ja bypassa cache).
   *  O store persistente (linkedin_scraped_posts) acumula posts entre coletas
   *  e serve tudo na hora, entao freshness perdida e limitada. */
  CACHE_TTL_MS: 72 * 60 * 60 * 1000,
  /** Max runs APIFY por workspace por dia (hard limit, evita bug de loop).
   *  Ajustado pra permitir 25 bridges × 4 refresh/dia = 100, com margem. */
  DAILY_RUN_LIMIT_HARD: 150,
  /** Default recomendado — cobre ~1 refresh full com cache mediano */
  DAILY_RUN_LIMIT_DEFAULT: 60,
  /** Preco APIFY estimado por Compute Unit (USD) — atualizar quando mudar */
  USD_PER_CU: 0.25,
  /** Threshold pro AdminPanel alertar custo mensal (USD/workspace) */
  MONTHLY_ALERT_USD: 50,
  /** Max profile URLs por refresh (bridges cap) — mesmo bundle com 70 bridges.
   *  V5.1: 30 → 50. Com relaxamento de tier (ready+emerging), bundles trazem
   *  mais bridges. Batching de 3+delay ja controla rate limit APIFY. */
  MAX_PROFILES_PER_RUN: 50,
  /** V5.3.2: 1 → 5 posts/pessoa por refresh.
   *  - Antes 1: perfis ativos apareciam com 0 posts (o unico puxado caia
   *    fora da janela / nao batia match / era repost).
   *  - Testado com 10 mas ficou caro (~$2/refresh full em 41 bridges).
   *  - 5 e o sweet-spot: cobre analistas que postam quase diario mantendo
   *    custo em ~$1/refresh full. O actor retorna os N mais recentes
   *    primeiro, entao 5 basta pra pegar pelo menos 1 dentro da janela
   *    de 168h em ~95% dos casos.
   *  - Custo: 41 bridges × 5 posts × $0.005 = ~$1 por refresh full.
   *  - Nao ha early-stop possivel (actor devolve batch de uma vez, nao
   *    streaming). Posts extras alem do primeiro valido ficam no store
   *    persistente pra proximas triagens (cache dedup por post_ref). */
  DEFAULT_POSTS_PER_PROFILE: 5,
} as const;

// Groundswell — categorias derivadas dos CSVs
export const GROUNDSWELL = {
  /** Bridges filtradas por essa dupla sao as monitoradas por default */
  DEFAULT_READINESS_TIER: "ready" as const,
  DEFAULT_CONTEXT_FIT: "in_context" as const,
  /** Max POIs sugeridos como target pra uma reply (dropdown UI) */
  POI_CANDIDATES_TOP_N: 5,
  /** Idade maxima do bundle antes de alertar "desatualizado" */
  BUNDLE_STALE_DAYS: 30,
  /** Bundle default do time — moic-icp */
  DEFAULT_BUNDLE_SLUG: "moic-icp",
  /** Relation types validos (Groundswell taxonomy) */
  RELATION_TYPES: [
    "inner_circle",
    "frequent_contact",
    "reciprocal_pair",
    "peer",
    "occasional_contact",
    "sporadic_contact",
    "episodic_contact",
    "one_off",
  ] as const,
  /** Multiplicadores por relation_type — pesa proximidade Bridge↔POI */
  RELATION_MULTIPLIERS: {
    inner_circle: 1.6,
    frequent_contact: 1.3,
    reciprocal_pair: 1.15,
    peer: 1.1,
    occasional_contact: 0.8,
    sporadic_contact: 0.5,
    episodic_contact: 0.4,
    one_off: 0.3,
  } as Record<string, number>,
} as const;
