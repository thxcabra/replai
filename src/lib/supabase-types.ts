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
  // @ do Twitter/X linkado ao workspace (lowercase, sem @). Usado pra scraping
  // de engagement no admin panel (futuro). Vazio = nao linkado.
  twitter_handle?: string;
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
  time_to_decide_ms: number | null;
  llm_provider: string | null;
  llm_model: string | null;
  llm_input_tokens: number | null;
  llm_output_tokens: number | null;
  llm_cost_usd: number | null;
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
    };
    Views: Record<string, { Row: Record<string, unknown>; Relationships: [] }>;
    Functions: Record<
      string,
      { Args: Record<string, unknown>; Returns: unknown }
    >;
  };
};
