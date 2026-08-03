// Provider de LLM ativo. Gemini e o default (free tier); Anthropic e o upgrade.
export type ProviderName = "gemini" | "anthropic";

// Configuracao persistida em chrome.storage.local.
// A chave da TwitterAPI fica embutida (ver keys.ts); as chaves de LLM ficam aqui
// (preenchidas pelo usuario na tela de configuracoes).
//
// V4: Voz por workspace. `voice` e o texto livre que define o tom/personalidade
// daquele workspace - anexado ao system prompt pra que cada workspace gere
// replies distintas. Pode vir de paste no textarea ou upload de .md/.pdf.
// SKILL.md fica com a parte generica (anti-tropes, categorias).
export interface Config {
  listId: string;
  twitterapi_key: string;
  llm_provider: ProviderName;
  gemini_api_key: string;
  anthropic_api_key: string;
  // Voz/personalidade deste workspace. Anexada ao SKILL antes da chamada LLM.
  voice: string;
  // Apenas pra UI exibir origem ("colado" ou "upload: <filename>").
  voice_source: string;
  // V4.1: prompt base custom por workspace. Se vazio, usa SKILL.md default.
  // Permite analista editar anti-padroes, categorias, lembretes pra ajustar
  // o tom dos replies. Sai como referencia tecnica DEPOIS da voz no prompt
  // final (a voz dita o tom, o base prompt dita as restricoes).
  basePrompt?: string;
  basePrompt_source?: string;  // "colado" ou "upload: <filename>"
  // @ do Twitter/X que o workspace representa (sem @). Usado pra scraping
  // futuro de engagement (admin task) e pra organizar replies por persona.
  twitter_handle: string;
  // V6: Persona formalizada. voice define o TOM/escrita. persona_public_target
  // define QUEM voce quer notar suas replies — descricoes livres do publico
  // ("VCs cripto de SP", "founders de fintech seed"). Injetado no prompt como
  // contexto adicional pro LLM ancorar dado/perspectiva que essa audiencia
  // valorizaria. Multi-canal (X + LinkedIn).
  persona_public_target?: string[];
  timeWindowHours: number;
  includeUnmapped: boolean;
  model: string;
  langs: string[];
  maxBatch: number;
  // Numero de paginas que fetchListTweets percorre na TwitterAPI por refresh.
  // Cada pagina = 1 request paga. Mais paginas = mais tweets unicos por sessao
  // (reduzindo clicks/cooldown), com custo proporcional. Range 1-10. Default 4.
  maxPages: number;
  // V4.1: multiplas Listas por workspace. Se vazio/undefined, usa o listId
  // top-level (compat com V4.0). activeListId aponta pra qual e usada agora.
  lists?: WorkspaceList[];
  activeListId?: string;
  // V4.1.1: quando ha multiplas listas, opcional fundir TODAS num refresh.
  // N× custo TwitterAPI mas 1× custo LLM (todos os tweets vao no mesmo batch).
  fetchAllLists?: boolean;
  // V5.0.4: watchtower_page_id removido. Ja nao aparece na UI ha versoes e
  // Watchtower e resolvido via Edge Function proxy com secret server-side.
  // V4.1: filtro de selecao via Gemini Flash batch (relevancia voz +
  // engajamento potencial do autor).
  selectionFilter?: SelectionFilterConfig;
  dryRun: boolean;

  // V5.1: toggle simetrico ao linkedin_enabled — user X-only nao ve chip
  // LinkedIn, user LinkedIn-only nao ve chip X + tab Fontes X etc.
  // Default true pra retro-compat com workspaces criados antes do V5.1.
  twitter_enabled?: boolean;
  // V5: LinkedIn (Groundswell) — canal opcional. Twitter continua funcionando
  // sem essas config. Ver docs/planning/proximo-passo.md pro racional.
  linkedin_enabled?: boolean;
  linkedin_voice?: string;
  /** Post cap soft por workspace/dia — LinkedIn ban threshold 50/dia */
  linkedin_daily_reply_limit?: number;
  /** APIFY runs cap por workspace/dia */
  linkedin_daily_run_limit?: number;
  /** Bundle id ativo — se undefined, cai pro bundle default do time (moic) */
  linkedin_bundle_id?: string;
  /** V5.1: persona LinkedIn separada — publicos-alvo especificos deste canal.
   *  Injetada em buildLinkedInSystemPrompt (nao em skill-prompt do X). */
  linkedin_persona_public_target?: string[];
  /** V5.1: janela de tempo do fetch LinkedIn (horas). Default 48h. */
  linkedin_time_window_hours?: number;
  /** V5.1: max posts LinkedIn por batch (proximo LLM). Default 50. */
  linkedin_max_batch?: number;
}

export interface WorkspaceList {
  id: string;       // ws_list_xxx, gerado local
  name: string;     // amigavel: "Lista IA", "Lista Finance"
  listId: string;   // id do X (puro)
}

export interface SelectionFilterConfig {
  enabled: boolean;
  topN: number;
  threshold?: number;        // 0-100; se setado, score combinado minimo
  engagementWeight: number;  // 0-1, default 0.6 (peso do engagement vs relevancia)
}

export const DEFAULT_SELECTION_FILTER: SelectionFilterConfig = {
  enabled: true,
  topN: 15,
  engagementWeight: 0.6,
};

export const DEFAULT_CONFIG: Config = {
  // Lista da Shira (mais ampla, ~1800 handles): padrao de fabrica. O usuario
  // pode trocar nas configuracoes; workspace novo ainda cai em settings (App
  // forca o view) pra o analista revisar antes de usar.
  listId: "2062525705263423672",
  twitterapi_key: "",
  llm_provider: "gemini",
  gemini_api_key: "",
  anthropic_api_key: "",
  voice: "",
  voice_source: "",
  twitter_handle: "",
  timeWindowHours: 10,
  includeUnmapped: true,
  model: "claude-sonnet-4-6",
  langs: ["en", "pt", ""],
  // V4.1: default subiu de 25 → 50 pra reduzir clicks/cooldown. Analista pode
  // descer pra 25/15 se preferir batches menores em workspaces ativos.
  maxBatch: 50,
  maxPages: 4,
  dryRun: false,
};

export type SortBy = "isv" | "recent" | "poi";

export const PROVIDER_OPTIONS: { id: ProviderName; label: string }[] = [
  { id: "gemini", label: "Gemini 2.5 Flash (gratuito)" },
  { id: "anthropic", label: "Claude Sonnet 4.6 (pago)" },
];

export const MODEL_OPTIONS = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6 (padrao)" },
  { id: "claude-opus-4-7", label: "Opus 4.7 (qualidade, ~5x custo)" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5 (barato, draft)" },
];

// Entrada do social graph (node_metrics_index.json)
export interface GraphEntry {
  isv: number;
  inferred_layer: number;
  is_poi: number;
}

// Indice handle(lowercase) -> entrada. Embarcado no bundle por default,
// pode ser sobreposto por upload de CSV pelo usuario (ver graph.ts).
export type Graph = Record<string, GraphEntry>;

// Metadata de um grafo uploaded pelo usuario, exposto na UI de settings.
export interface GraphMeta {
  filename: string;
  uploadedAt: number;
  handleCount: number;
  poiCount: number;
}

// Subconjunto do schema da TwitterAPI.io que usamos.
// Campos opcionais porque a API pode omitir.
export interface RawTweetAuthor {
  userName?: string;
  followers?: number;
  isAutomated?: boolean;
}

// V4.1: media anexada ao tweet (foto/video/gif). Parse vem do payload da
// TwitterAPI.io (entities.media[] ou extendedEntities.media[]).
export interface TweetMedia {
  type: "photo" | "video" | "gif";
  url: string;             // URL da media (visivel pro LLM e pra UI)
  thumbnailUrl?: string;   // miniatura preferida pra UI; cai pra url se vazio
  width?: number;
  height?: number;
}

// V4.1.1: engagement metrics do tweet (likes/RTs/replies/quotes/views).
// Vem da TwitterAPI.io e e usado pra ranking "viral posts" na aba Posts.
export interface TweetEngagement {
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
  quoteCount?: number;
  viewCount?: number;
  bookmarkCount?: number;
}

export interface RawTweet {
  id?: string;
  url?: string;
  text?: string;
  createdAt?: string;
  lang?: string;
  isReply?: boolean;
  inReplyToId?: string;
  inReplyToUsername?: string;
  conversationId?: string;
  isLimitedReply?: boolean;
  author?: RawTweetAuthor;
  quoted_tweet?: RawTweet | null;
  retweeted_tweet?: RawTweet | null;
  // V4.1: media anexada (fotos/videos/gifs). Sempre normalizado por
  // twitterapi.ts via parseMediaFromRaw.
  media?: TweetMedia[];
  // V4.1.1: engagement metrics (likes, RTs, replies, etc)
  engagement?: TweetEngagement;
  // Sintetico: o orchestrator popula com o tweet pai pra replies dentro da
  // janela, via fetchTweetsBatch. Permite que buildContext inclua o texto do
  // tweet original na context (a API nao devolve isso inline pra replies).
  // null = parent foi buscado mas nao encontrado/visivel. undefined = nao buscado.
  parent_tweet?: RawTweet | null;
}

export interface TwitterListResponse {
  tweets?: RawTweet[];
  next_cursor?: string;
  has_next_page?: boolean;
  // a API pode usar status/message em erro
  status?: string;
  message?: string;
}

// V4.1: tier do autor derivado de isv/followers/POI. Usado pra calibrar tom
// no skill-prompt (2.10): mega autor raramente engaja → tom diferente de mid.
export type AuthorTier = "mega" | "large" | "mid" | "small";

// V4.1: contexto estrategico do autor pra reply engagement-aware (2.10).
// Populado em orchestrator a partir do EnrichedTweet + scores do scorer (2.9).
export interface AuthorContext {
  handle: string;
  isv: number;
  inferred_layer: number;
  is_poi: boolean;
  tier: AuthorTier;
  // scores do selection-scorer (null se filtro desabilitado/sem chave)
  engagement_potential: number | null;
  persona_relevance: number | null;
  // do intelligence layer (sub-camada B)
  is_first_contact?: boolean;
  engagement_back_rate?: number;   // 0-1
  successful_categories?: string[];
  cooldown_recommended?: boolean;
}

// Tweet ja enriquecido e pronto pro payload da skill
export interface PayloadTweet {
  tweet_id: string;
  handle: string;
  text: string;
  // codigo do idioma detectado pelo TwitterAPI ("en", "pt", ou "" indefinido).
  // Sinal autoritativo pra skill replicar o idioma na reply.
  lang: string;
  timestamp?: string;
  isv: number;
  inferred_layer: number;
  is_poi: number;
  context: string | null;
  not_in_graph?: boolean;
  // V4.1: media URLs anexadas ao tweet. LLM usa pra entender contexto visual
  // (multimodal). UI usa pra renderizar thumbs.
  media?: TweetMedia[];
  // V4.1: contexto estrategico do autor (orchestrator popula apos scorer).
  author_context?: AuthorContext;
  // V4.1: attachments anexados pelo analista (URLs de reports/articles).
  attachments?: PayloadAttachment[];
  // V4.1: flag de regeneracao individual (skill-prompt usa pra evitar
  // duplicar lente das replies que ja existem).
  regen?: {
    reply_index: number;
    keep_categories: string[];  // categorias ja em uso, evitar
  };
}

export interface PayloadAttachment {
  url: string;
  hint?: string;  // ex: "report da McKinsey citado no tweet"
}

export interface SkillPayload {
  tweets: PayloadTweet[];
}

// Saida da skill
export type ValueCategory =
  | "dado_concreto"
  | "referencia_nominal"
  | "experiencia_builder"
  | "pergunta_especialista"
  | "info_pratica"
  | "nomear_fenomeno"
  | "caso_concreto"
  | "cross_pollination"
  | "update_info";

export interface SkillReply {
  text: string;
  category: ValueCategory | string;
}

export interface SkillResult {
  tweet_id: string;
  handle: string;
  isv: number;
  inferred_layer: number;
  is_poi: number;
  pattern: number;
  pattern_label: string;
  replies: SkillReply[];
  not_in_graph?: boolean;
}

export interface SkillSummary {
  received: number;
  passed: number;
  discarded: number;
}

export interface SkillOutput {
  results: SkillResult[];
  summary: SkillSummary;
}

// Razoes de descarte no pre-filtro (so pra debug/contador na UI)
export type DiscardReason =
  | "out_of_window"
  | "no_text"
  | "too_short"
  | "pure_retweet"
  | "lang_filtered"
  | "not_in_graph_strict"
  | "automated";

// Tweet enriquecido + metadados que a UI usa pra render
export interface EnrichedTweet extends PayloadTweet {
  url?: string;
  is_limited_reply?: boolean;
  // RawTweet original anexada pra pushReplyLog poder extrair author/thread/etc
  // sem ter que re-fetch. Setado em prefilter.ts e quick_test.
  raw_meta?: RawTweet;
  // V4.1: scores do selection-scorer (2.9). Null = scorer pulado.
  persona_relevance?: number | null;
  engagement_potential?: number | null;
  selection_combined?: number | null;
  selection_reason?: string | null;
  // V4.1: intelligence layer (2.11)
  intelligence?: IntelligenceBundle;
}

// V4.1 — Camada de inteligencia (2.11)
export interface PostAnalysis {
  entities: {
    mentions: string[];   // @handles citados no texto
    tickers: string[];    // $TICKER
    urls: string[];       // URLs externas (excluindo x.com)
    hashtags: string[];   // #hashtag
  };
  topics: string[];        // tags semanticas detectadas (heuristica simples)
  claim_type: "opinion" | "fact_claim" | "question" | "announcement" | "personal" | "joke" | "thread_continuation" | "unknown";
  engagement_hooks: {
    has_open_question: boolean;
    has_pollable_claim: boolean;
  };
  data_gaps: string[];     // o que NAO temos (sinal de incerteza pro LLM)
}

export interface AuthorProfile {
  handle: string;
  interaction_count: number;
  we_posted_count: number;
  we_verified_count: number;
  author_engaged_count: number;
  engagement_back_rate: number;       // 0-1
  last_interaction_at: string | null;
  successful_categories: string[];
  cooldown_recommended: boolean;
  is_first_contact: boolean;
  avg_relevance: number | null;
  avg_engagement: number | null;
}

export interface BatchRelations {
  hot_topics: { topic: string; count: number }[];
  co_mentioned_entities: { entity: string; by_authors: string[] }[];
}

export interface IntelligenceBundle {
  analysis: PostAnalysis;
  author_profile?: AuthorProfile;       // null se anonymous/sem historico
  batch_signals?: {
    is_part_of_hot_topic: boolean;
    co_mentioned_with_others: boolean;
  };
}

// Resultado por tweet juntando o que a skill devolveu com o tweet original
export interface RenderedTweet {
  tweet: EnrichedTweet;
  result: SkillResult;
}

// Cache de sessao guardado em storage (per-workspace)
export interface SessionCache {
  timestamp: number;
  collected: number;
  passed: number;
  rendered: RenderedTweet[];
}

// Container isolado de configuracao + grafo + cache. O usuario troca entre
// workspaces pra alternar contextos (cliente, persona, lista, chave de api).
export interface Workspace {
  id: string;
  name: string;
  createdAt: number;
  config: Config;
}

// Versao "leve" do workspace pra listar no picker sem carregar tudo.
export interface WorkspaceMeta {
  id: string;
  name: string;
  createdAt: number;
}
