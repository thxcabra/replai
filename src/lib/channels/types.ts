// V5 — Tipos channel-agnosticos.
//
// Coexistem com os tipos legacy Tweet*/PayloadTweet em src/lib/types.ts pra
// nao quebrar o pipeline atual. Refactor mecanico (rename Tweet -> Post)
// vira depois em passo separado. Adapter LinkedIn ja consome estes tipos
// diretamente; adapter Twitter faz uma camada de shim pra converter
// RawTweet -> RawPost sem tocar no orchestrator existente.

export type Channel = "twitter" | "linkedin";

export interface PostMedia {
  type: "photo" | "video" | "gif" | "document";
  url: string;
  thumbnail_url?: string;
}

export interface PostEngagement {
  likes?: number;
  comments?: number;
  reactions?: number;
  reshares?: number;
  quotes?: number;         // X-only
  bookmarks?: number;      // X-only
  impressions?: number;
}

// RawPost — shape agnostico depois do fetch.
// Twitter adapter: converte RawTweet -> RawPost. LinkedIn: direto do APIFY.
export interface RawPost {
  channel: Channel;
  /** ID canonico. tweet_id no X, activity URN no LinkedIn */
  post_ref: string;
  /** URN LinkedIn tem prefixo (urn:li:activity:...); no X e so o numero */
  raw_ref?: string;
  author_handle: string;
  author_display_name: string;
  author_avatar_url?: string;
  author_headline?: string;      // LinkedIn typically
  text: string;
  lang?: string;
  created_at: string;            // ISO
  url: string;
  media: PostMedia[];
  engagement: PostEngagement;
  /** V5: LinkedIn — tipo do post pra filtrar reposts (nao servem pra Groundswell) */
  post_type?: "regular" | "repost" | "quote" | "article" | "job" | "unknown";
  /** Referencia opcional a thread parent / quoted post */
  context?: {
    kind: "reply_to" | "quote" | "reshare";
    ref: string;
    author_handle?: string;
    text?: string;
  };
  /** LinkedIn: se veio de query de profile posts, quem foi o profile */
  fetched_via_profile?: string;
  raw_meta?: Record<string, unknown>;
}

// Fetch abstraction
export type CachePolicy = "prefer" | "force" | "bypass";

/** V5.3.2: bridge com posts_limit especifico. Usado no orchestrator pra
 *  variar quantos posts pedir por bridge baseado em readiness_tier —
 *  bridges 'ready' pedem 5, 'promising' pedem 3, 'not_yet' pedem 1.
 *  Reduz custo APIFY sem perder cobertura das bridges de sinal alto. */
export interface BridgeFetchTarget {
  url: string;
  postsLimit: number;
}

export interface FetchOptions {
  sinceMs: number;
  maxItems?: number;
  cache?: CachePolicy;
  /** LinkedIn Groundswell: lista de bridge public_identifiers a monitorar.
   *  Usa DEFAULT_POSTS_PER_PROFILE pra cada uma. */
  bridgeIdentifiers?: string[];
  /** V5.3.2: alternativa a `bridgeIdentifiers` com posts_limit customizado
   *  por bridge. Se ambos presentes, `bridgeTargets` vence. */
  bridgeTargets?: BridgeFetchTarget[];
}

export interface FetchCost {
  cu?: number;
  usd?: number;
  provider?: string;
}

export interface FetchResult {
  posts: RawPost[];
  cached: boolean;
  cost?: FetchCost;
  fetchedAt: number;
  /** Bytes retornados pelo actor pra tracking */
  bytes?: number;
}

// Adapter contract
export interface ChannelAdapter {
  channel: Channel;
  fetchPosts(config: unknown, options: FetchOptions): Promise<FetchResult>;
  buildReplyIntent(
    post: RawPost,
    replyText: string
  ): {
    kind: "intent_url" | "clipboard_and_open";
    url: string;
    /** Se true, UI copia texto pro clipboard antes de abrir url */
    needsClipboard: boolean;
  };
  charLimit: number;
}

// ============================================================================
// Groundswell types (do bundle CSV/manifest)
// ============================================================================

export interface GroundswellManifest {
  workspace: string;
  delivery_date: string;
  generated_at: string;
  latest_engagement_date: string;
  files: Record<string, { rows?: number; bytes: number }>;
  skipped?: unknown[];
}

export interface GroundswellProfile {
  profile_id: string;               // ACoAAA... (LinkedIn) ou @handle (X)
  name: string;
  node_type?: string;
  public_identifier?: string;       // daniel-finlay-33318a10
  linkedin_url?: string;
  headline?: string;
  current_company?: string;
  current_position?: string;
  followers?: number;
  is_poi: boolean;
  tracked_layer?: number;
  inferred_layer?: number;
  pagerank?: number;
  distinct_source_count?: number;
  pagerank_adjusted?: number;
  hits_authority?: number;
  influence_surplus?: number;
  followers_percentile?: number;
  pagerank_adjusted_percentile?: number;
  hits_authority_percentile?: number;
  authority_consensus_percentile?: number;
  influence_surplus_percentile?: number;
  isv?: number;
  computed_at?: string;
}

export type ContextFit = "in_context" | "out_of_context";
export type ReadinessTier = "ready" | "emerging" | "needs_work";

export interface GroundswellBridge {
  bridge_id: string;
  name: string;
  headline?: string;
  current_company?: string;
  context_fit?: ContextFit | string;
  readiness_score?: number;
  readiness_tier?: ReadinessTier | string;
  profile_fit_score?: number;
  voice_quality_score?: number;
  proximity_score?: number;
  audience_score?: number;
  rationale?: string;
  n_interactions?: number;
  n_comments?: number;
  analyzed_at?: string;
  model?: string;
}

export interface GroundswellRelationship {
  source_id: string;
  source_name?: string;
  source_is_poi?: boolean;
  target_id: string;
  target_name?: string;
  target_is_poi?: boolean;
  relation_type?: string;
  relation_rationale?: string;
  n_interactions?: number;
  follower_asymmetry?: number;
  reciprocity?: boolean;
  dominant_intention?: string;
  top_topics?: string;
  analyzed_at?: string;
  model?: string;
}

export interface GroundswellInteraction {
  source_id: string;
  source_name?: string;
  target_id?: string;
  target_name?: string;
  ref_type?: "reaction" | "comment" | string;
  post_id?: string;
  post_url?: string;
  post_content?: string;
  commentary?: string;
  topics?: string;
  intention?: string;
  language?: string;
  date_utc?: string;
}

export interface GroundswellSourceProfile {
  source_id: string;
  source_name?: string;
  source_is_poi?: boolean;
  n_interactions?: number;
  n_authors?: number;
  n_authored_posts?: number;
  pct_endorsement?: number;
  pct_technical?: number;
  engaged_topic_distribution?: Record<string, number>;
  authored_topic_distribution?: Record<string, number>;
  intention_distribution?: Record<string, number>;
  relation_type_distribution?: Record<string, number>;
  languages?: string;
  computed_at?: string;
}

export interface GroundswellBundle {
  workspace_slug: string;
  delivery_date: string;
  latest_engagement_date: string;
  channel: Channel;
  manifest: GroundswellManifest;
  cohort_summary?: string;
  brand_radar?: Record<string, number | string>;
  profiles: GroundswellProfile[];
  bridges: GroundswellBridge[];
  relationships: GroundswellRelationship[];
  interactions: GroundswellInteraction[];
  source_profiles: GroundswellSourceProfile[];
}

// Bundle summary (persistido no chrome.storage.local pra UI rapida sem query full)
export interface GroundswellBundleSummary {
  id: string;                     // UUID no Supabase
  /** V5.1: nome da "lista" (subgrupo POI+Bridge). Migration 0011. */
  name: string;
  /** V5.2: origem do bundle. 'groundswell' = pipeline completo com POIs+scoring;
   *  'manual' = CSV leve (nome+URL), sem POI-target, reply direto ao autor. */
  source: "groundswell" | "manual";
  workspace_slug: string;
  delivery_date: string;
  latest_engagement_date: string;
  channel: Channel;
  is_default: boolean;
  is_active: boolean;
  n_profiles: number;
  n_pois: number;
  n_bridges: number;
  n_bridges_ready: number;
  n_relationships: number;
  n_interactions: number;
  uploaded_at: string;
}

// POI target candidate (do RPC get_poi_candidates_for_bridge)
export interface PoiCandidate {
  poi_id: string;
  poi_name: string;
  relation_type: string;
  n_interactions: number;
  reciprocity: boolean;
  isv: number;
  followers: number;
  composite_score: number;
}

// ============================================================================
// Reply flow LinkedIn
// ============================================================================

export interface LinkedInReplyDraft {
  post: RawPost;
  bridge?: GroundswellBridge;
  poi_target?: PoiCandidate;
  relation_type_bridge_to_poi?: string;
  strategy_note?: string;
  reply_text: string;
  reply_category?: string;
  llm_provider?: string;
  llm_model?: string;
}
