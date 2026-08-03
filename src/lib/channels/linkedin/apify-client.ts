// V5 — APIFY client (thin) — invoca Edge Function `apify-fetch`.
//
// Token, cache, quota, cost tracking, allowlist de actors: TUDO server-side.
// Client so envia { workspace_id, actor_id, input } e recebe { items, cached, cost }.
//
// V5.0.1: usa `fetch` direto (nao supabase.functions.invoke) porque o wrapper
// engole o body quando status != 2xx, resultando em "non-2xx status code"
// generico sem detalhe. Fetch direto expoe o JSON de erro.

import { getSession } from "../../auth";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";

export interface ApifyFetchRequest {
  workspace_id: string;
  actor_id: string;
  input: Record<string, unknown>;
  bypass_cache?: boolean;
  cache_ttl_ms?: number;
  /** V5.3: chave APIFY opcional do profile do user. Se presente, edge
   *  function usa ela em vez do secret server-side. HTTPS-only, autenticado
   *  via JWT, dominio pinned pra @moicdigital. */
  apify_token?: string;
}

export interface ApifyFetchResponse {
  items: unknown[];
  cached: boolean;
  cost: { cu: number; usd: number };
  fetched_at: string;
}

export class ApifyQuotaError extends Error {
  daily_count: number;
  constructor(message: string, daily_count: number) {
    super(message);
    this.name = "ApifyQuotaError";
    this.daily_count = daily_count;
  }
}

export class ApifyError extends Error {
  status: number;
  detail?: string;
  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.name = "ApifyError";
    this.status = status;
    this.detail = detail;
  }
}

export async function apifyFetch(
  req: ApifyFetchRequest
): Promise<ApifyFetchResponse> {
  const session = await getSession();
  if (!session?.access_token) {
    throw new ApifyError("sem sessao ativa — faca login", 401);
  }
  const url = `${SUPABASE_URL}/functions/v1/apify-fetch`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req),
    });
  } catch (e) {
    throw new ApifyError(
      `network error chamando apify-fetch: ${(e as Error).message}`,
      0
    );
  }

  const text = await resp.text();
  let parsed: {
    items?: unknown[];
    cached?: boolean;
    cost?: { cu?: number; usd?: number };
    fetched_at?: string;
    error?: string;
    detail?: string;
    message?: string;
    daily_count?: number;
  } = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { error: `resposta nao-JSON (status ${resp.status}): ${text.slice(0, 200)}` };
  }

  if (!resp.ok) {
    if (parsed.error === "daily_limit_exceeded") {
      throw new ApifyQuotaError(
        parsed.message ?? "APIFY daily limit exceeded",
        parsed.daily_count ?? 0
      );
    }
    // V5.3.2: mensagem mais util. "Bad Request" solto nao ajuda ninguem;
    // enriquecemos com o input que estavamos mandando + status + body parcial.
    const errMsg =
      parsed.error ??
      parsed.message ??
      `apify-fetch retornou HTTP ${resp.status} (${resp.statusText || "sem detalhe"})`;
    const detail =
      parsed.detail ??
      parsed.message ??
      `actor=${req.actor_id} input=${JSON.stringify(req.input).slice(0, 200)}`;
    console.warn("[apify-fetch] error:", {
      status: resp.status,
      statusText: resp.statusText,
      actor: req.actor_id,
      input: req.input,
      response: parsed,
    });
    throw new ApifyError(errMsg, resp.status, detail);
  }

  return {
    items: parsed.items ?? [],
    cached: parsed.cached ?? false,
    cost: {
      cu: parsed.cost?.cu ?? 0,
      usd: parsed.cost?.usd ?? 0,
    },
    fetched_at: parsed.fetched_at ?? new Date().toISOString(),
  };
}
