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
  // @ do Twitter/X que o workspace representa (sem @). Usado pra scraping
  // futuro de engagement (admin task) e pra organizar replies por persona.
  twitter_handle: string;
  timeWindowHours: number;
  includeUnmapped: boolean;
  model: string;
  langs: string[];
  maxBatch: number;
  dryRun: boolean;
}

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
  maxBatch: 25,
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
