// Tipos das tabelas do Supabase, alinhados com supabase/migrations/0001_init.sql.
// Hand-written; pode ser regenerado via `npx supabase gen types typescript
// --project-id <id>` depois pra ficar 100% espelho do schema.

import type { ValueCategory } from "./types";

export type UserRole = "admin" | "analyst";

export interface ProfileRow {
  id: string;
  email: string;
  name: string | null;
  display_name: string | null;
  twitterapi_key: string | null;
  gemini_api_key: string | null;
  anthropic_api_key: string | null;
  // V4.1.1: token de Internal integration do Notion. Usado pra pull do
  // Watchtower Daily Digest na aba Posts.
  notion_api_token: string | null;
  // V5.3: chave APIFY opcional (override do secret server-side). Se null/vazia,
  // edge function apify-fetch cai no APIFY_TOKEN do Supabase secrets.
  apify_api_key: string | null;
  active_workspace_id: string | null;
  setup_complete: boolean;
  first_seen_at: string;
  last_seen_at: string;
  total_replies: number;
  created_at: string;
  updated_at: string;
}

export interface UserRoleRow {
  user_id: string;
  role: UserRole;
  granted_by: string | null;
  granted_at: string;
}

export interface WorkspaceConfigJson {
  listId: string;
  llm_provider: "gemini" | "anthropic";
  timeWindowHours: number;
  includeUnmapped: boolean;
  model: string;
  langs: string[];
  maxBatch: number;
  dryRun: boolean;
  // Voz / personalidade deste workspace, anexada ao system prompt. Sincronizada
  // cross-device. Chaves de API NUNCA aqui - elas vivem no profile (RLS + AES).
  voice?: string;
  // Origem da voz pra UI exibir ("paste" ou "upload: <nome do arquivo>").
  voice_source?: string;
  // V4.1: prompt base custom (sobrescreve SKILL.md default). Vazio = usa default.
  basePrompt?: string;
  basePrompt_source?: string;
  // @ do Twitter/X linkado ao workspace (lowercase, sem @). Usado pra scraping
  // de engagement no admin panel (futuro). Vazio = nao linkado.
  twitter_handle?: string;
  // V6: Persona — publicos-alvo estrategicos livremente descritos ("VCs cripto SP",
  // "founders fintech seed"). Voz define TOM; persona_public_target define QUEM
  // deve notar suas replies. Injetado no prompt como contexto ancilar.
  persona_public_target?: string[];
  // V5.0.4: watchtower_page_id removido do type Config; mantido opcional aqui
  // pra compat com workspaces antigos ja salvos no jsonb.
  watchtower_page_id?: string;
  // V4.1: multi-list por workspace. Se vazio/undefined, usa listId top-level
  // (compat com workspaces V4.0).
  lists?: Array<{ id: string; name: string; listId: string }>;
  activeListId?: string;
  fetchAllLists?: boolean;
  // V4.1: filtro de selecao dual (relevancia voz + engagement potential) via
  // Gemini Flash batch. Pre-triagem.
  selectionFilter?: {
    enabled: boolean;
    topN: number;
    threshold?: number;
    engagementWeight: number;
  };
  // V4.1: maxPages controla quantas paginas da TwitterAPI sao fetched por
  // refresh. Default 4. Range 1-10.
  maxPages?: number;
  // V5.1: toggle simetrico ao linkedin_enabled. Default true.
  twitter_enabled?: boolean;
  // V5: canal LinkedIn (Groundswell) — todos os campos sao opcionais, so
  // materializam quando canal LinkedIn e habilitado no workspace.
  /** V5.1: persona LinkedIn separada — publicos-alvo especificos deste canal */
  linkedin_persona_public_target?: string[];
  linkedin_time_window_hours?: number;
  linkedin_max_batch?: number;
  linkedin_enabled?: boolean;
  linkedin_voice?: string;
  linkedin_daily_reply_limit?: number;
  linkedin_daily_run_limit?: number;
  linkedin_bundle_id?: string;
}

export interface WorkspaceRow {
  id: string;
  user_id: string;
  name: string;
  config: WorkspaceConfigJson;
  created_at: string;
  updated_at: string;
}

export interface VoiceVersionRow {
  id: string;
  workspace_id: string;
  user_id: string;
  voice_text: string;
  voice_source: string | null;
  voice_hash: string;
  version: number;
  created_at: string;
}

export interface RepliedTweetRow {
  id: string;
  user_id: string;
  workspace_id: string;
  tweet_id: string;
  tweet_author: string | null;
  tweet_text: string | null;
  reply_text: string | null;
  reply_category: ValueCategory | string | null;
  reply_index: number | null;
  was_edited: boolean;
  posted_confirmed: boolean;
  replied_at: string;
}

export interface SessionLogRow {
  id: string;
  user_id: string;
  user_email: string;
  workspace_id: string;
  workspace_name: string;
  started_at: string;
  ended_at: string | null;
  fetch_count: number | null;
  fetch_ms: number | null;
  triage_passed: number | null;
  triage_selected: number | null;
  triage_mode: "list" | "swipe" | null;
  llm_called: boolean;
  llm_provider: string | null;
  llm_model: string | null;
  llm_ms: number | null;
  llm_input_tokens: number | null;
  llm_output_tokens: number | null;
  llm_cost_usd: number | null;
  replies_generated: number | null;
  replies_clicked: number;
  replies_posted: number;
  replies_skipped: number;
  error_type: string | null;
  error_message: string | null;
}

// Subset usado pra .insert() em reply_logs. Quase 50 colunas; todas opcionais
// exceto user/workspace/tweet/reply_text obrigatorios (NOT NULL no schema).
export interface ReplyLogRow {
  id: string;
  user_id: string;
  user_email: string;
  workspace_id: string;
  workspace_name: string;
  session_id: string | null;
  voice_version_id: string | null;
  voice_snapshot: string | null;
  config_snapshot: Record<string, unknown> | null;
  // tweet
  tweet_id: string;
  tweet_url: string | null;
  tweet_handle: string | null;
  tweet_text: string | null;
  tweet_lang: string | null;
  tweet_isv: number | null;
  tweet_is_poi: number | null;
  tweet_inferred_layer: number | null;
  tweet_author_followers: number | null;
  tweet_author_is_automated: boolean | null;
  tweet_author_verified: boolean | null;
  tweet_author_display_name: string | null;
  tweet_created_at: string | null;
  tweet_age_minutes: number | null;
  tweet_is_reply: boolean | null;
  tweet_in_reply_to_username: string | null;
  tweet_conversation_id: string | null;
  tweet_is_quote: boolean | null;
  tweet_quoted_handle: string | null;
  tweet_quoted_text: string | null;
  tweet_is_limited_reply: boolean | null;
  tweet_thread_size: number | null;
  tweet_char_count: number | null;
  tweet_has_media: boolean | null;
  tweet_has_links: boolean | null;
  tweet_hashtags: string[] | null;
  tweet_mentions: string[] | null;
  tweet_emoji_count: number | null;
  // reply
  reply_text: string;
  reply_text_original: string | null;
  reply_category: string | null;
  reply_pattern: number | null;
  reply_pattern_label: string | null;
  reply_index: number | null;
  all_candidates: Array<{ text: string; category: string }> | null;
  was_edited: boolean;
  posted_confirmed: boolean | null;
  posted_at: string | null;
  posted_reply_id: string | null;
  decision: "posted" | "skipped" | "edited_only" | "ignored" | null;
  // V4.1: discriminacao reply vs QT (migration 0003)
  decision_type: "reply" | "quote_tweet" | null;
  time_to_decide_ms: number | null;
  // V4.1: scores do selection-scorer + tier autor + engagement flag (migration 0004)
  persona_relevance: number | null;
  engagement_potential: number | null;
  selection_combined: number | null;
  author_tier: "mega" | "large" | "mid" | "small" | null;
  author_engaged_at_post: boolean | null;
  llm_provider: string | null;
  llm_model: string | null;
  llm_input_tokens: number | null;
  llm_output_tokens: number | null;
  llm_cost_usd: number | null;
  logged_at: string;
  // V4.1.2: metricas manuais preenchidas pelo analista (sem scraping)
  actual_likes: number | null;
  actual_retweets: number | null;
  actual_replies: number | null;
  actual_quotes: number | null;
  op_replied_back: boolean | null;
  analyst_notes: string | null;
  metrics_updated_at: string | null;
}

// V4.1.8: tracking de posts gerados (paralelo a reply_logs).
export interface PostLogRow {
  id: string;
  user_id: string;
  user_email: string;
  workspace_id: string;
  workspace_name: string;
  session_id: string | null;
  voice_snapshot: string | null;
  voice_version_id: string | null;
  config_snapshot: Record<string, unknown> | null;
  angle: string;
  hook: string | null;
  body: string;
  why: string | null;
  category: string | null;
  image_model: string | null;
  image_mime_type: string | null;
  image_data_url: string | null;
  watchtower_title: string | null;
  watchtower_matched_by: string | null;
  watchtower_date_requested: string | null;
  viral_posts_count: number | null;
  recent_categories: string[] | null;
  llm_provider: string | null;
  llm_model: string | null;
  llm_input_tokens: number | null;
  llm_output_tokens: number | null;
  llm_cost_usd: number | null;
  was_edited: boolean;
  posted_at: string | null;
  posted_post_id: string | null;
  decision: "posted" | "skipped" | "edited_only" | "ignored" | null;
  actual_likes: number | null;
  actual_retweets: number | null;
  actual_replies: number | null;
  actual_quotes: number | null;
  actual_bookmarks: number | null;
  actual_views: number | null;
  analyst_notes: string | null;
  metrics_updated_at: string | null;
  time_to_decide_ms: number | null;
  logged_at: string;
}

export interface EventRow {
  id: string;
  user_id: string;
  workspace_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  ts: string;
}

// Database type pro supabase-js. Cada tabela precisa de Relationships: [].
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Partial<ProfileRow> & { id: string; email: string };
        Update: Partial<ProfileRow>;
        Relationships: [];
      };
      user_roles: {
        Row: UserRoleRow;
        Insert: Partial<UserRoleRow> & { user_id: string };
        Update: Partial<UserRoleRow>;
        Relationships: [];
      };
      workspaces: {
        Row: WorkspaceRow;
        Insert: Partial<WorkspaceRow> & {
          id: string;
          user_id: string;
          name: string;
          config: WorkspaceConfigJson;
        };
        Update: Partial<WorkspaceRow>;
        Relationships: [];
      };
      voice_versions: {
        Row: VoiceVersionRow;
        Insert: Partial<VoiceVersionRow> & {
          workspace_id: string;
          user_id: string;
          voice_text: string;
          voice_hash: string;
          version: number;
        };
        Update: Partial<VoiceVersionRow>;
        Relationships: [];
      };
      replied_tweets: {
        Row: RepliedTweetRow;
        Insert: Partial<RepliedTweetRow> & {
          user_id: string;
          workspace_id: string;
          tweet_id: string;
        };
        Update: Partial<RepliedTweetRow>;
        Relationships: [];
      };
      session_logs: {
        Row: SessionLogRow;
        Insert: Partial<SessionLogRow> & {
          user_id: string;
          user_email: string;
          workspace_id: string;
          workspace_name: string;
        };
        Update: Partial<SessionLogRow>;
        Relationships: [];
      };
      reply_logs: {
        Row: ReplyLogRow;
        Insert: Partial<ReplyLogRow> & {
          user_id: string;
          user_email: string;
          workspace_id: string;
          workspace_name: string;
          tweet_id: string;
          reply_text: string;
        };
        Update: Partial<ReplyLogRow>;
        Relationships: [];
      };
      events: {
        Row: EventRow;
        Insert: Partial<EventRow> & { user_id: string; type: string };
        Update: Partial<EventRow>;
        Relationships: [];
      };
      post_logs: {
        Row: PostLogRow;
        Insert: Partial<PostLogRow> & {
          user_id: string;
          user_email: string;
          workspace_id: string;
          workspace_name: string;
          angle: string;
          body: string;
        };
        Update: Partial<PostLogRow>;
        Relationships: [];
      };
    };
    Views: Record<string, { Row: Record<string, unknown>; Relationships: [] }>;
    Functions: Record<
      string,
      { Args: Record<string, unknown>; Returns: unknown }
    >;
  };
};
