import { getSession } from "./auth";
import { supabase, isSupabaseConfigured } from "./supabase";

// Telemetria de uso. Envia events em batch pra Supabase (sem bloquear UI).
// Eventos sao append-only (tabela events) e SEMPRE sanitizados antes de
// enviar pra impedir vazamento de chaves.

export type EventType =
  | "session_started"
  | "tweets_fetched"
  | "llm_called"
  | "reply_clicked"
  | "reply_edited"
  | "post_confirmed"
  | "post_skipped"
  | "voice_updated"
  | "workspace_created"
  | "workspace_deleted"
  | "keys_updated"
  | "quick_test_run";

// Payloads sao "open" propositalmente (jsonb). Cada hook decide quais campos
// passar. NUNCA passar chaves de API, mesmo redacted. Padrao do schema:
// - duration_ms: number — pra latency
// - tweet_id: string
// - workspace_id: string (passado separado, ver track())
// - provider: "gemini" | "anthropic"
// - reply_index: number
// - error: string (mensagem human-readable, sem stack)

interface QueuedEvent {
  workspace_id: string | null;
  type: EventType;
  payload: Record<string, unknown>;
  ts: string;
}

// Lista de fragmentos de chave que jamais devem aparecer em payload.
// Caso o codigo passe algo nesse formato, removemos automaticamente.
const KEY_FIELDS_BLACKLIST = [
  "key",
  "secret",
  "password",
  "token",
  "twitterapi_key",
  "gemini_api_key",
  "anthropic_api_key",
  "client_secret",
];

// Remove recursivamente qualquer campo cujo nome bata com a blacklist.
// Defesa em profundidade contra vazamento. Retorna nova obj/array, nao muta.
function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (KEY_FIELDS_BLACKLIST.some((b) => lower.includes(b))) continue;
      out[k] = sanitize(v);
    }
    return out;
  }
  return value;
}

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL_MS = 30_000;
const MAX_QUEUE = 200; // safety net se ficar muito tempo offline

async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (queue.length === 0) return;
  if (!isSupabaseConfigured()) {
    queue = [];
    return;
  }

  const session = await getSession();
  if (!session?.user) {
    // sem sessao: descarta (events sao parte da identidade do user;
    // sem user nao tem onde guardar)
    queue = [];
    return;
  }

  const userId = session.user.id;
  const batch = queue.map((e) => ({
    user_id: userId,
    workspace_id: e.workspace_id,
    type: e.type,
    payload: e.payload,
    ts: e.ts,
  }));
  queue = [];

  try {
    const { error } = await supabase.from("events").insert(batch);
    if (error) {
      console.warn("[metrics] flush falhou:", error);
    }
  } catch (e) {
    console.warn("[metrics] flush exception:", e);
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flush().catch(() => {});
  }, FLUSH_INTERVAL_MS);
}

// API publica. Nunca throws. Nunca bloqueia.
export function track(
  type: EventType,
  payload: Record<string, unknown> = {},
  workspaceId: string | null = null
): void {
  try {
    const cleanPayload = sanitize(payload) as Record<string, unknown>;
    queue.push({
      workspace_id: workspaceId,
      type,
      payload: cleanPayload,
      ts: new Date().toISOString(),
    });
    if (queue.length >= MAX_QUEUE) {
      flush().catch(() => {});
      return;
    }
    scheduleFlush();
  } catch (e) {
    console.warn("[metrics] track falhou:", e);
  }
}

// Forca flush imediato. Util em handlers tipo onbeforeunload ou ao trocar de
// view importante (logout etc).
export async function flushNow(): Promise<void> {
  await flush();
}
