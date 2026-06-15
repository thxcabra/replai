import { getSession } from "./auth";
import { isSupabaseConfigured, supabase } from "./supabase";

// API de admin/master. Wraps RPC is_admin() + queries cross-user.
// RLS no Supabase garante que so admins recebem dados de outros users —
// nao confiamos no client. UI usa isAdmin() pra esconder/mostrar.

const IS_ADMIN_CACHE_KEY = "is_admin_cached";
const IS_ADMIN_TTL_MS = 5 * 60 * 1000; // 5 min

interface CachedAdmin {
  value: boolean;
  cached_at: number;
  user_id: string;
}

// Checa se o user atual e admin. Cacheia em chrome.storage.local com TTL 5min
// (evita roundtrip a cada render). Force=true ignora cache.
export async function isAdmin(force = false): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const session = await getSession();
  if (!session?.user) return false;

  if (!force) {
    try {
      const cached = await chrome.storage.local.get(IS_ADMIN_CACHE_KEY);
      const c = cached[IS_ADMIN_CACHE_KEY] as CachedAdmin | undefined;
      if (
        c &&
        c.user_id === session.user.id &&
        Date.now() - c.cached_at < IS_ADMIN_TTL_MS
      ) {
        return c.value;
      }
    } catch {
      /* fallthrough pra RPC */
    }
  }

  const { data, error } = await supabase.rpc("is_admin");
  if (error) {
    console.warn("[admin] is_admin RPC falhou:", error);
    return false;
  }
  const value = Boolean(data);
  try {
    await chrome.storage.local.set({
      [IS_ADMIN_CACHE_KEY]: {
        value,
        cached_at: Date.now(),
        user_id: session.user.id,
      } satisfies CachedAdmin,
    });
  } catch {
    /* ignore */
  }
  return value;
}

export async function clearAdminCache(): Promise<void> {
  await chrome.storage.local.remove(IS_ADMIN_CACHE_KEY);
}

// Lista de usuarios + stats (via view admin_overview). RLS filtra: admin ve tudo.
export interface AdminUserRow {
  user_id: string;
  user_email: string;
  display_name: string | null;
  role: "admin" | "analyst";
  first_seen_at: string;
  last_seen_at: string;
  total_replies: number;
  replies_total: number;
  replies_posted: number;
  replies_skipped: number;
  replies_last_7d: number;
  workspaces_count: number;
  total_cost_usd: number;
}

// Replies "verificadas" = postou + colou URL/ID. Sinal mais forte que so
// `decision='posted'` (que e o auto-report do analista). Util pra filtrar
// metricas de "vai vou contar so o que foi REALMENTE postado e checavel".
export interface VerifiedStats {
  total_verified: number;
  total_posted: number;
  verified_pct: number;
  by_user: { user_email: string; verified: number; posted: number }[];
}

export async function fetchVerifiedStats(): Promise<VerifiedStats> {
  if (!isSupabaseConfigured()) {
    return {
      total_verified: 0,
      total_posted: 0,
      verified_pct: 0,
      by_user: [],
    };
  }
  const { data, error } = await supabase
    .from("reply_logs")
    .select("user_email, decision, posted_reply_id")
    .eq("decision", "posted");
  if (error) {
    console.warn("[admin] fetchVerifiedStats:", error);
    return {
      total_verified: 0,
      total_posted: 0,
      verified_pct: 0,
      by_user: [],
    };
  }
  const rows = (data ?? []) as Array<{
    user_email: string;
    decision: string;
    posted_reply_id: string | null;
  }>;
  const total_posted = rows.length;
  const total_verified = rows.filter((r) => r.posted_reply_id).length;
  const byUserMap = new Map<string, { verified: number; posted: number }>();
  for (const r of rows) {
    const cur = byUserMap.get(r.user_email) ?? { verified: 0, posted: 0 };
    cur.posted += 1;
    if (r.posted_reply_id) cur.verified += 1;
    byUserMap.set(r.user_email, cur);
  }
  return {
    total_verified,
    total_posted,
    verified_pct:
      total_posted > 0
        ? Math.round((total_verified / total_posted) * 100)
        : 0,
    by_user: Array.from(byUserMap.entries())
      .map(([user_email, s]) => ({ user_email, ...s }))
      .sort((a, b) => b.verified - a.verified),
  };
}

export async function listUsers(): Promise<AdminUserRow[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase
    .from("admin_overview")
    .select("*")
    .order("last_seen_at", { ascending: false });
  if (error) {
    console.warn("[admin] listUsers falhou:", error);
    return [];
  }
  return (data ?? []) as AdminUserRow[];
}

export async function promoteUser(userId: string): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error("Supabase nao configurado.");
  const session = await getSession();
  if (!session?.user) throw new Error("Sem sessao.");
  const { error } = await supabase
    .from("user_roles")
    .upsert(
      {
        user_id: userId,
        role: "admin",
        granted_by: session.user.id,
        granted_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  if (error) throw error;
}

export async function revokeAdmin(userId: string): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error("Supabase nao configurado.");
  const session = await getSession();
  if (!session?.user) throw new Error("Sem sessao.");
  // Defesa: nao deixa revogar a si mesmo (evita lock-out)
  if (userId === session.user.id) {
    throw new Error("Voce nao pode revogar o proprio admin.");
  }
  const { error } = await supabase
    .from("user_roles")
    .update({ role: "analyst", granted_by: session.user.id })
    .eq("user_id", userId);
  if (error) throw error;
}

// ---- Export paginado pra CSV/JSON ----

export type ExportTable =
  | "reply_logs"
  | "replied_tweets"
  | "session_logs"
  | "events";

export interface ExportFilters {
  table: ExportTable;
  startDate?: string;        // ISO
  endDate?: string;          // ISO
  userEmails?: string[];     // filtra por email (se aplicavel)
  workspaceId?: string;
  replyCategory?: string;
  postedConfirmed?: boolean | null;
}

const PAGE_SIZE = 1000;

// Carrega em paginas e retorna o array completo. Pra > 50k rows considere
// usar a versao streaming abaixo. Callback de progress opcional.
export async function adminExport(
  filters: ExportFilters,
  onProgress?: (loaded: number) => void
): Promise<Record<string, unknown>[]> {
  if (!isSupabaseConfigured()) throw new Error("Supabase nao configurado.");

  const tsCol =
    filters.table === "reply_logs"
      ? "logged_at"
      : filters.table === "replied_tweets"
        ? "replied_at"
        : filters.table === "session_logs"
          ? "started_at"
          : "ts";

  const rows: Record<string, unknown>[] = [];
  let offset = 0;

  while (true) {
    let q = supabase
      .from(filters.table)
      .select("*")
      .order(tsCol, { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (filters.startDate) q = q.gte(tsCol, filters.startDate);
    if (filters.endDate) q = q.lte(tsCol, filters.endDate);
    if (filters.workspaceId) q = q.eq("workspace_id", filters.workspaceId);
    if (filters.userEmails?.length && filters.table === "reply_logs") {
      q = q.in("user_email", filters.userEmails);
    }
    if (filters.replyCategory && filters.table === "reply_logs") {
      q = q.eq("reply_category", filters.replyCategory);
    }
    if (
      filters.postedConfirmed !== undefined &&
      filters.table === "reply_logs"
    ) {
      if (filters.postedConfirmed === null) {
        q = q.is("posted_confirmed", null);
      } else {
        q = q.eq("posted_confirmed", filters.postedConfirmed);
      }
    }

    const { data, error } = await q;
    if (error) throw error;
    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    onProgress?.(rows.length);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    // safety: cap em 50k linhas pra nao travar o side panel
    if (offset >= 50_000) {
      console.warn("[admin] export atingiu cap de 50k rows, truncando");
      break;
    }
  }

  return rows;
}

// Converte array de objetos pra CSV. Usa primeira row pra header.
// Escapa virgula, aspas, newlines.
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  // coleta TODAS as colunas (uniao das keys de todas as rows)
  const colSet = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) colSet.add(k);
  const cols = Array.from(colSet);
  const escape = (v: unknown): string => {
    if (v == null) return "";
    let s: string;
    if (typeof v === "object") s = JSON.stringify(v);
    else s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      s = '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [cols.join(",")];
  for (const r of rows) {
    lines.push(cols.map((c) => escape(r[c])).join(","));
  }
  return lines.join("\n");
}
