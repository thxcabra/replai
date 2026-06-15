import { getSession } from "./auth";
import { supabase } from "./supabase";
import type {
  ProfileRow,
  RepliedTweetRow,
  WorkspaceConfigJson,
  WorkspaceRow,
} from "./supabase-types";

// Camada pura de operacoes Supabase. NAO toca em chrome.storage diretamente,
// nao orquestra cache. Cada funcao retorna Row da tabela ou throws ApiError-ish
// (passa o erro do Supabase com info enriquecida).
//
// storage.ts (shim sync-aware) e quem chama essas funcoes condicionalmente
// (so se houver sessao logada) e mantem o mirror local em chrome.storage.

export class SyncError extends Error {
  constructor(
    public op: string,
    public cause: unknown
  ) {
    const message =
      cause && typeof cause === "object" && "message" in cause
        ? (cause as { message: string }).message
        : String(cause);
    super(`Sync ${op}: ${message}`);
    this.name = "SyncError";
  }
}

async function requireUserId(): Promise<string> {
  const session = await getSession();
  if (!session?.user) {
    throw new SyncError("auth", new Error("sem sessao ativa"));
  }
  return session.user.id;
}

// ---- Profile ----

export async function pullProfile(): Promise<ProfileRow | null> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new SyncError("pullProfile", error);
  return data;
}

export async function pushProfile(
  updates: Partial<Omit<ProfileRow, "id" | "created_at" | "updated_at">>
): Promise<ProfileRow> {
  const session = await getSession();
  if (!session?.user) {
    throw new SyncError("auth", new Error("sem sessao ativa"));
  }
  // Upsert (cria profile se nao existir, atualiza se sim). Defesa contra
  // cenario onde handle_new_user trigger nao rodou (ex: usuario existia em
  // auth.users antes da migration ser rodada, ou trigger foi dropado e
  // recriado). Sem isso, todo push falha com "Cannot coerce to single JSON".
  const userId = session.user.id;
  const email = session.user.email ?? "";
  const insertPayload = {
    id: userId,
    email,
    // name default = parte antes do @ (mesma logica do trigger)
    name: email.includes("@") ? email.split("@")[0] : email,
    ...updates,
  };
  const { data, error } = await supabase
    .from("profiles")
    .upsert(insertPayload, { onConflict: "id" })
    .select()
    .single();
  if (error) throw new SyncError("pushProfile", error);
  return data;
}

// ---- Workspaces ----

export async function pullWorkspaces(): Promise<WorkspaceRow[]> {
  await requireUserId(); // RLS filtra pelo user, mas valida sessao antes
  const { data, error } = await supabase
    .from("workspaces")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new SyncError("pullWorkspaces", error);
  return data ?? [];
}

export async function pushWorkspace(input: {
  id: string;
  name: string;
  config: WorkspaceConfigJson;
}): Promise<WorkspaceRow> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("workspaces")
    .upsert(
      {
        id: input.id,
        user_id: userId,
        name: input.name,
        config: input.config,
      },
      { onConflict: "id" }
    )
    .select()
    .single();
  if (error) throw new SyncError("pushWorkspace", error);
  return data;
}

export async function deleteWorkspaceCloud(id: string): Promise<void> {
  await requireUserId();
  const { error } = await supabase.from("workspaces").delete().eq("id", id);
  if (error) throw new SyncError("deleteWorkspaceCloud", error);
}

// ---- Replied tweets ----

export async function pullReplied(
  workspaceId: string
): Promise<RepliedTweetRow[]> {
  await requireUserId();
  const { data, error } = await supabase
    .from("replied_tweets")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("replied_at", { ascending: false });
  if (error) throw new SyncError("pullReplied", error);
  return data ?? [];
}

// Upsert (workspace_id + tweet_id e unique). Usado pra marcar respondido
// + atualizar metadata (was_edited, posted_confirmed, reply_text, etc).
export async function upsertReplied(input: {
  workspace_id: string;
  tweet_id: string;
  tweet_author?: string;
  tweet_text?: string;
  reply_text?: string;
  reply_category?: string;
  reply_index?: number;
  was_edited?: boolean;
  posted_confirmed?: boolean;
}): Promise<RepliedTweetRow> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("replied_tweets")
    .upsert(
      {
        user_id: userId,
        workspace_id: input.workspace_id,
        tweet_id: input.tweet_id,
        tweet_author: input.tweet_author ?? null,
        tweet_text: input.tweet_text ?? null,
        reply_text: input.reply_text ?? null,
        reply_category: input.reply_category ?? null,
        reply_index: input.reply_index ?? null,
        was_edited: input.was_edited ?? false,
        posted_confirmed: input.posted_confirmed ?? false,
      },
      { onConflict: "workspace_id,tweet_id" }
    )
    .select()
    .single();
  if (error) throw new SyncError("upsertReplied", error);
  return data;
}

export async function removeReplied(
  workspaceId: string,
  tweetId: string
): Promise<void> {
  await requireUserId();
  const { error } = await supabase
    .from("replied_tweets")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("tweet_id", tweetId);
  if (error) throw new SyncError("removeReplied", error);
}

// ---- Reply logs (analytics) ----
// Tabela separada de replied_tweets, append-only. Captura todo reply disparado
// com contexto rico (voz no momento, tweet, todas as 3 sugestoes do LLM, edits,
// confirmacao). Pra analise offline de tom de voz, preferencia de categoria, etc.

export interface ReplyLogInput {
  user_email: string;
  workspace_id: string;
  workspace_name: string;
  session_id?: string | null;
  voice_snapshot: string;
  voice_version_id?: string | null;
  config_snapshot?: Record<string, unknown> | null;
  // tweet basico
  tweet_id: string;
  tweet_url?: string | null;
  tweet_handle?: string | null;
  tweet_text?: string | null;
  tweet_lang?: string | null;
  tweet_isv?: number | null;
  tweet_is_poi?: number | null;
  tweet_inferred_layer?: number | null;
  // tweet autor (4)
  tweet_author_followers?: number | null;
  tweet_author_is_automated?: boolean | null;
  tweet_author_verified?: boolean | null;
  tweet_author_display_name?: string | null;
  // tweet timing (2)
  tweet_created_at?: string | null;
  tweet_age_minutes?: number | null;
  // tweet thread/conversation (7)
  tweet_is_reply?: boolean | null;
  tweet_in_reply_to_username?: string | null;
  tweet_conversation_id?: string | null;
  tweet_is_quote?: boolean | null;
  tweet_quoted_handle?: string | null;
  tweet_quoted_text?: string | null;
  tweet_is_limited_reply?: boolean | null;
  tweet_thread_size?: number | null;
  // tweet content meta (6)
  tweet_char_count?: number | null;
  tweet_has_media?: boolean | null;
  tweet_has_links?: boolean | null;
  tweet_hashtags?: string[] | null;
  tweet_mentions?: string[] | null;
  tweet_emoji_count?: number | null;
  // reply
  reply_text: string;                              // texto final (com edits)
  reply_text_original?: string | null;             // texto que o LLM gerou
  reply_category?: string | null;
  reply_pattern?: number | null;
  reply_pattern_label?: string | null;
  reply_index?: number | null;
  all_candidates?: Array<{ text: string; category: string }> | null;
  // decision
  was_edited?: boolean;
  posted_confirmed?: boolean | null;
  posted_at?: string | null;
  posted_reply_id?: string | null;
  decision?: "posted" | "skipped" | "edited_only" | "ignored" | null;
  time_to_decide_ms?: number | null;
  // llm
  llm_provider?: string | null;
  llm_model?: string | null;
  llm_input_tokens?: number | null;
  llm_output_tokens?: number | null;
  llm_cost_usd?: number | null;
}

export async function pushReplyLog(input: ReplyLogInput): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase.from("reply_logs").insert({
    user_id: userId,
    user_email: input.user_email,
    workspace_id: input.workspace_id,
    workspace_name: input.workspace_name,
    session_id: input.session_id ?? null,
    voice_snapshot: input.voice_snapshot,
    voice_version_id: input.voice_version_id ?? null,
    config_snapshot: input.config_snapshot ?? null,
    // tweet basico
    tweet_id: input.tweet_id,
    tweet_url: input.tweet_url ?? null,
    tweet_handle: input.tweet_handle ?? null,
    tweet_text: input.tweet_text ?? null,
    tweet_lang: input.tweet_lang ?? null,
    tweet_isv: input.tweet_isv ?? null,
    tweet_is_poi: input.tweet_is_poi ?? null,
    tweet_inferred_layer: input.tweet_inferred_layer ?? null,
    // autor
    tweet_author_followers: input.tweet_author_followers ?? null,
    tweet_author_is_automated: input.tweet_author_is_automated ?? null,
    tweet_author_verified: input.tweet_author_verified ?? null,
    tweet_author_display_name: input.tweet_author_display_name ?? null,
    // timing
    tweet_created_at: input.tweet_created_at ?? null,
    tweet_age_minutes: input.tweet_age_minutes ?? null,
    // thread
    tweet_is_reply: input.tweet_is_reply ?? null,
    tweet_in_reply_to_username: input.tweet_in_reply_to_username ?? null,
    tweet_conversation_id: input.tweet_conversation_id ?? null,
    tweet_is_quote: input.tweet_is_quote ?? null,
    tweet_quoted_handle: input.tweet_quoted_handle ?? null,
    tweet_quoted_text: input.tweet_quoted_text ?? null,
    tweet_is_limited_reply: input.tweet_is_limited_reply ?? null,
    tweet_thread_size: input.tweet_thread_size ?? null,
    // content meta
    tweet_char_count: input.tweet_char_count ?? null,
    tweet_has_media: input.tweet_has_media ?? null,
    tweet_has_links: input.tweet_has_links ?? null,
    tweet_hashtags: input.tweet_hashtags ?? null,
    tweet_mentions: input.tweet_mentions ?? null,
    tweet_emoji_count: input.tweet_emoji_count ?? null,
    // reply
    reply_text: input.reply_text,
    reply_text_original: input.reply_text_original ?? null,
    reply_category: input.reply_category ?? null,
    reply_pattern: input.reply_pattern ?? null,
    reply_pattern_label: input.reply_pattern_label ?? null,
    reply_index: input.reply_index ?? null,
    all_candidates: input.all_candidates ?? null,
    // decision
    was_edited: input.was_edited ?? false,
    posted_confirmed: input.posted_confirmed ?? null,
    posted_at: input.posted_at ?? null,
    posted_reply_id: input.posted_reply_id ?? null,
    decision: input.decision ?? null,
    time_to_decide_ms: input.time_to_decide_ms ?? null,
    // llm
    llm_provider: input.llm_provider ?? null,
    llm_model: input.llm_model ?? null,
    llm_input_tokens: input.llm_input_tokens ?? null,
    llm_output_tokens: input.llm_output_tokens ?? null,
    llm_cost_usd: input.llm_cost_usd ?? null,
  });
  if (error) throw new SyncError("pushReplyLog", error);
}

// ---- Pull-all (usado pelo background polling + setup wizard) ----

export interface FullState {
  profile: ProfileRow | null;
  workspaces: WorkspaceRow[];
}

export async function pullAll(): Promise<FullState> {
  const [profile, workspaces] = await Promise.all([
    pullProfile(),
    pullWorkspaces(),
  ]);
  return { profile, workspaces };
}
