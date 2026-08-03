import { getSession } from "./auth";
import { isSupabaseConfigured, supabase } from "./supabase";

// Tracking estruturado de sessoes (1 row por "atualizar"). Complementa events
// (genericos) com um modelo relacional rico pra analytics. Inclui FALHAS, ao
// contrario de events que so registra etapas que completam.
//
// Fluxo tipico:
//   const sid = await startSession(ws);              // cria row, retorna id
//   await recordFetch(sid, count, ms);               // apos TwitterAPI
//   await recordTriage(sid, passed, selected, mode); // apos prefilter + UI
//   await recordLLM(sid, {provider, model, ms, ...});// apos generateReplies
//   ... usuario decide cada reply ...
//   await bumpClicked(sid); / bumpPosted(sid); / bumpSkipped(sid);
//   // ou se erro:
//   await recordError(sid, 'twitterapi', 'rate limited');
//
// Cada funcao e fail-safe: se Supabase nao configurado ou sem sessao, NO-OP.

export type SessionId = string | null;

export async function startSession(input: {
  workspace_id: string;
  workspace_name: string;
}): Promise<SessionId> {
  if (!isSupabaseConfigured()) return null;
  const session = await getSession();
  if (!session?.user) return null;
  const { data, error } = await supabase
    .from("session_logs")
    .insert({
      user_id: session.user.id,
      user_email: session.user.email ?? "",
      workspace_id: input.workspace_id,
      workspace_name: input.workspace_name,
    })
    .select("id")
    .single();
  if (error) {
    console.warn("[session] startSession falhou:", error);
    return null;
  }
  return data.id as string;
}

async function patch(
  sessionId: SessionId,
  fields: Record<string, unknown>
): Promise<void> {
  if (!sessionId) return;
  const { error } = await supabase
    .from("session_logs")
    .update(fields)
    .eq("id", sessionId);
  if (error) console.warn("[session] patch falhou:", error);
}

export async function recordFetch(
  sessionId: SessionId,
  count: number,
  ms: number
): Promise<void> {
  await patch(sessionId, { fetch_count: count, fetch_ms: ms });
}

export async function recordTriage(
  sessionId: SessionId,
  passed: number,
  selected: number,
  mode: "list" | "swipe" | null
): Promise<void> {
  await patch(sessionId, {
    triage_passed: passed,
    triage_selected: selected,
    triage_mode: mode,
  });
}

// V4.1.14 (WR-10): so atualiza triage_selected + mode. Antes a chamada em
// generateRepliesForSelected sobrescrevia triage_passed (= total visible
// pos-prefilter+scorer) com selected.length, corrompendo funnel analytics.
export async function recordTriageSelected(
  sessionId: SessionId,
  selected: number,
  mode: "list" | "swipe" | null
): Promise<void> {
  await patch(sessionId, {
    triage_selected: selected,
    triage_mode: mode,
  });
}

export async function recordLLM(
  sessionId: SessionId,
  input: {
    provider: string;
    model: string;
    ms: number;
    input_tokens: number | null;
    output_tokens: number | null;
    cost_usd: number | null;
    replies_generated: number;
  }
): Promise<void> {
  await patch(sessionId, {
    llm_called: true,
    llm_provider: input.provider,
    llm_model: input.model,
    llm_ms: input.ms,
    llm_input_tokens: input.input_tokens,
    llm_output_tokens: input.output_tokens,
    llm_cost_usd: input.cost_usd,
    replies_generated: input.replies_generated,
  });
}

export async function recordError(
  sessionId: SessionId,
  type: "twitterapi" | "llm" | "rls" | "unknown",
  message: string
): Promise<void> {
  await patch(sessionId, {
    error_type: type,
    error_message: message.slice(0, 500),
    ended_at: new Date().toISOString(),
  });
}

export async function endSession(sessionId: SessionId): Promise<void> {
  await patch(sessionId, { ended_at: new Date().toISOString() });
}

// Bumps atomicos (RPC seria melhor, mas pra ~10 users esta tudo bem usar
// read-modify-write client-side com cuidado).
async function bumpCol(sessionId: SessionId, col: string): Promise<void> {
  if (!sessionId) return;
  const { data: cur } = await supabase
    .from("session_logs")
    .select(col)
    .eq("id", sessionId)
    .single();
  const current =
    (cur as Record<string, number> | null)?.[col] ?? 0;
  await patch(sessionId, { [col]: current + 1 });
}

export async function bumpClicked(sessionId: SessionId): Promise<void> {
  await bumpCol(sessionId, "replies_clicked");
}
export async function bumpPosted(sessionId: SessionId): Promise<void> {
  await bumpCol(sessionId, "replies_posted");
}
export async function bumpSkipped(sessionId: SessionId): Promise<void> {
  await bumpCol(sessionId, "replies_skipped");
}
