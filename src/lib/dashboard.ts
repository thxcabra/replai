import { getSession } from "./auth";
import { isSupabaseConfigured, supabase } from "./supabase";

// Camada de queries pro Dashboard. Faz fetch de rows recentes do Supabase e
// agrega client-side (suficiente pra escala de 10 analistas; se crescer,
// migra pra SQL views).

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DashboardData {
  totals: {
    week: number;
    month: number;
    all_time: number;
  };
  rates: {
    edited_pct: number;
    confirmed_pct: number;
  };
  top_categories: { category: string; count: number }[];
  by_day_14d: { date: string; count: number }[];
  avg_session_minutes: number | null;
  events_in_window: number;
}

const EMPTY_DATA: DashboardData = {
  totals: { week: 0, month: 0, all_time: 0 },
  rates: { edited_pct: 0, confirmed_pct: 0 },
  top_categories: [],
  by_day_14d: [],
  avg_session_minutes: null,
  events_in_window: 0,
};

export async function fetchDashboardData(
  workspaceId: string | null = null
): Promise<DashboardData> {
  if (!isSupabaseConfigured()) return EMPTY_DATA;
  const session = await getSession();
  if (!session?.user) return EMPTY_DATA;

  const now = Date.now();
  const monthAgo = new Date(now - 30 * DAY_MS).toISOString();
  const fourteenDaysAgo = new Date(now - 14 * DAY_MS).toISOString();
  const weekCutoff = now - 7 * DAY_MS;

  // ---- replied_tweets ----
  let repliedQuery = supabase
    .from("replied_tweets")
    .select("tweet_id, reply_category, was_edited, posted_confirmed, replied_at")
    .gte("replied_at", monthAgo)
    .order("replied_at", { ascending: false });
  if (workspaceId) repliedQuery = repliedQuery.eq("workspace_id", workspaceId);

  const { data: replied, error: rerr } = await repliedQuery;
  if (rerr) {
    console.warn("[dashboard] replied query falhou:", rerr);
  }

  // ---- all-time count (lightweight) ----
  let allTimeQuery = supabase
    .from("replied_tweets")
    .select("*", { count: "exact", head: true });
  if (workspaceId) allTimeQuery = allTimeQuery.eq("workspace_id", workspaceId);
  const { count: allTimeCount } = await allTimeQuery;

  const rows = (replied ?? []) as Array<{
    reply_category: string | null;
    was_edited: boolean;
    posted_confirmed: boolean;
    replied_at: string;
  }>;

  let weekCount = 0;
  let editedCount = 0;
  let confirmedCount = 0;
  const categoryMap = new Map<string, number>();
  const byDayMap = new Map<string, number>();

  for (const r of rows) {
    const ts = Date.parse(r.replied_at);
    if (ts >= weekCutoff) weekCount++;
    if (r.was_edited) editedCount++;
    if (r.posted_confirmed) confirmedCount++;
    const cat = r.reply_category ?? "sem categoria";
    categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + 1);

    // bucket por dia (YYYY-MM-DD)
    if (ts >= now - 14 * DAY_MS) {
      const day = r.replied_at.slice(0, 10);
      byDayMap.set(day, (byDayMap.get(day) ?? 0) + 1);
    }
  }

  const top_categories = [...categoryMap.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Preenche 14 dias contiguos pro grafico (com 0 onde nao houve replies).
  const by_day_14d: { date: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
    by_day_14d.push({ date: day, count: byDayMap.get(day) ?? 0 });
  }

  // ---- events: tempo medio por sessao ----
  // Pareia session_started com o llm_called subsequente (mesmo workspace, ts
  // ascendente). Sessao sem llm_called e ignorada (dry-run sem chamada).
  let eventsQuery = supabase
    .from("events")
    .select("type, ts, workspace_id")
    .gte("ts", fourteenDaysAgo)
    .in("type", ["session_started", "llm_called"])
    .order("ts", { ascending: true });
  if (workspaceId) eventsQuery = eventsQuery.eq("workspace_id", workspaceId);

  const { data: eventsData, error: eerr } = await eventsQuery;
  if (eerr) console.warn("[dashboard] events query falhou:", eerr);

  const events = (eventsData ?? []) as Array<{
    type: string;
    ts: string;
    workspace_id: string | null;
  }>;

  // Pareamento simples: agrupa por workspace_id e zip start->end
  const sessionsByWs = new Map<string, { start: number; end: number }[]>();
  const pendingStart = new Map<string, number>();
  for (const ev of events) {
    const ws = ev.workspace_id ?? "_global";
    const ts = Date.parse(ev.ts);
    if (ev.type === "session_started") {
      pendingStart.set(ws, ts);
    } else if (ev.type === "llm_called") {
      const start = pendingStart.get(ws);
      if (start !== undefined) {
        const list = sessionsByWs.get(ws) ?? [];
        list.push({ start, end: ts });
        sessionsByWs.set(ws, list);
        pendingStart.delete(ws);
      }
    }
  }
  const allDurations: number[] = [];
  for (const list of sessionsByWs.values()) {
    for (const s of list) allDurations.push(s.end - s.start);
  }
  const avg_session_minutes =
    allDurations.length > 0
      ? Math.round(
          allDurations.reduce((a, b) => a + b, 0) / allDurations.length / 60000
        )
      : null;

  return {
    totals: {
      week: weekCount,
      month: rows.length,
      all_time: allTimeCount ?? rows.length,
    },
    rates: {
      edited_pct:
        rows.length > 0 ? Math.round((editedCount / rows.length) * 100) : 0,
      confirmed_pct:
        rows.length > 0
          ? Math.round((confirmedCount / rows.length) * 100)
          : 0,
    },
    top_categories,
    by_day_14d,
    avg_session_minutes,
    events_in_window: events.length,
  };
}

// Export completo de atividade: replied_tweets + reply_logs + events do user
// nos ultimos 90 dias. Devolve um JSON pronto pra download.
export async function exportActivityJson(
  workspaceId: string | null = null
): Promise<{
  exported_at: string;
  scope: { workspace_id: string | null };
  replied_tweets: Record<string, unknown>[];
  reply_logs: Record<string, unknown>[];
  events: Record<string, unknown>[];
}> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase nao configurado neste build.");
  }
  const session = await getSession();
  if (!session?.user) throw new Error("Sem sessao ativa.");

  const cutoff = new Date(Date.now() - 90 * DAY_MS).toISOString();

  let repliedQ = supabase
    .from("replied_tweets")
    .select("*")
    .gte("replied_at", cutoff);
  if (workspaceId) repliedQ = repliedQ.eq("workspace_id", workspaceId);

  let logsQ = supabase
    .from("reply_logs")
    .select("*")
    .gte("logged_at", cutoff);
  if (workspaceId) logsQ = logsQ.eq("workspace_id", workspaceId);

  let eventsQ = supabase.from("events").select("*").gte("ts", cutoff);
  if (workspaceId) eventsQ = eventsQ.eq("workspace_id", workspaceId);

  const [replied, logs, events] = await Promise.all([repliedQ, logsQ, eventsQ]);

  return {
    exported_at: new Date().toISOString(),
    scope: { workspace_id: workspaceId },
    replied_tweets: (replied.data ?? []) as Record<string, unknown>[],
    reply_logs: (logs.data ?? []) as Record<string, unknown>[],
    events: (events.data ?? []) as Record<string, unknown>[],
  };
}
