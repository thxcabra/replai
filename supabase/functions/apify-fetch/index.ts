// V5 — Edge Function: proxy do APIFY pra buscar posts LinkedIn (e futuros channels).
//
// POR QUE EXISTE:
//   - Zerar exposicao do APIFY_TOKEN no client (mesmo padrao Notion V4.1.7)
//   - Cache SERVER-SIDE compartilhado por workspace → dedup entre analistas
//     (2 users no mesmo workspace disparando mesmo query = 1 chamada APIFY)
//   - Quota + rate limit centralizados (dificil de burlar client-side)
//   - Cost tracking em apify_runs table
//
// FLUXO:
//   1. Client POST /functions/v1/apify-fetch com { workspace_id, actor_id, input }
//   2. Auth: JWT + dominio permitido (ALLOWED_EMAIL_DOMAIN) + workspace valido
//   3. Cache: sha256(actor_id|inputJSON|bundleContext) — hit retorna items
//   4. Quota: conta runs do workspace/dia, deny se >= APIFY.DAILY_RUN_LIMIT_HARD
//   5. Miss: chama APIFY sync endpoint, salva apify_cache + apify_runs
//   6. Retorna { items, cached, cost }
//
// DEPLOY:
//   supabase secrets set APIFY_TOKEN=apify_api_xxx
//   supabase secrets set ALLOWED_EMAIL_DOMAIN=moicdigital   # opcional
//   supabase functions deploy apify-fetch --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Espelha extension ID publicada (V4.1.14 CR-01)
const ALLOWED_ORIGIN = "chrome-extension://lhoachajfmnfabhcmjkibijjcdbmgjll";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Vary": "Origin",
};

// Dominio de login permitido (secret ALLOWED_EMAIL_DOMAIN, default
// "moicdigital"). Valor sem ponto aceita qualquer TLD (@acme.com,
// @acme.com.br); com ponto exige match exato. Mesma regra de
// src/lib/util.ts (isEmailDomainAllowed).
const ALLOWED_EMAIL_DOMAIN = (
  Deno.env.get("ALLOWED_EMAIL_DOMAIN")?.trim() || "moicdigital"
).toLowerCase().replace(/^@/, "");

function isEmailDomainAllowed(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const host = email.slice(at + 1).trim().toLowerCase();
  return ALLOWED_EMAIL_DOMAIN.includes(".")
    ? host === ALLOWED_EMAIL_DOMAIN
    : host.startsWith(`${ALLOWED_EMAIL_DOMAIN}.`);
}

// Hard limit — protege contra loop de bug (client burlado ou race).
// V5.1: 150 → 500 default. Configuravel via env `APIFY_DAILY_LIMIT_HARD`
// (setar em Supabase secrets pra ajustar sem redeploy).
// Dev/teste bate 150 facil (18 bridges x ~10 refreshes = 180 runs).
const DAILY_RUN_LIMIT_HARD = parseInt(
  Deno.env.get("APIFY_DAILY_LIMIT_HARD") ?? "500",
  10
);
const CACHE_TTL_MS_DEFAULT = 24 * 60 * 60 * 1000;
const USD_PER_CU_DEFAULT = 0.25;
const ACTOR_USD_PER_RESULT: Record<string, number> = {
  // Preço público em 2026-07-28: US$5 / 1.000 resultados.
  "apimaestro/linkedin-profile-posts": 0.005,
};

// Actors permitidos (allowlist) — evita client passar actor arbitrario.
// Add a esta lista conforme testar em prod. Sem allowlist, um bug no client
// poderia rodar actor errado e cobrar dinheiro.
//
// V5.0.2: apidojo/linkedin-profile-posts-scraper NAO existe (404). Trocamos
// pro apimaestro/linkedin-profile-posts (actor popular, ~$5/1000 posts).
const ALLOWED_ACTORS = new Set([
  "apimaestro/linkedin-profile-posts",
  "harvestapi/linkedin-profile-posts",
  "curious_coder/linkedin-post-search-scraper",
  "dev_fusion/Linkedin-Profile-Scraper",
]);

// ---- Types ----

interface ApifyRequestBody {
  workspace_id: string;
  actor_id: string;
  input: Record<string, unknown>;
  /** Opcional — desativa cache pra debug. Somente admin. */
  bypass_cache?: boolean;
  /** Opcional — sobrescreve TTL default */
  cache_ttl_ms?: number;
  /** V5.3: token APIFY do profile do user (opcional). Se presente e nao vazio,
   *  usa em vez do APIFY_TOKEN do secret. Retro-compat: request sem esse
   *  campo continua funcionando com o secret padrao. */
  apify_token?: string;
}

interface ApifyRunResponse {
  data: {
    id: string;
    status: string;
    stats?: {
      computeUnits?: number;
    };
    defaultDatasetId?: string;
  };
}

interface ApifyDatasetItem {
  [key: string]: unknown;
}

// ---- Helpers ----

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

async function sha256(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Ordena keys recursivamente pra hash estavel independente da ordem no JSON */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") +
    "}"
  );
}

async function authenticateRequest(
  req: Request
): Promise<
  | { userId: string; email: string; supa: ReturnType<typeof createClient> }
  | { error: string; status: number }
> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: "missing authorization", status: 401 };
  }
  const jwt = authHeader.slice(7);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return { error: "supabase env missing", status: 500 };
  }
  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    return { error: "invalid jwt", status: 401 };
  }
  const email = data.user.email ?? "";
  if (!isEmailDomainAllowed(email)) {
    return { error: "domain not allowed", status: 403 };
  }
  return { userId: data.user.id, email, supa: client };
}

async function checkWorkspaceAccess(
  supa: ReturnType<typeof createClient>,
  workspaceId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supa
    .from("workspaces")
    .select("id, user_id")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error || !data) return false;
  return (data as { user_id: string }).user_id === userId;
}

async function getDailyRunCount(
  supa: ReturnType<typeof createClient>,
  workspaceId: string
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supa
    .from("apify_runs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .gte("ran_at", since)
    .eq("cached", false);
  if (error) return 0;
  return count ?? 0;
}

// ---- APIFY call ----

async function runApifyActorSync(
  actorId: string,
  input: Record<string, unknown>,
  token: string
): Promise<{ items: ApifyDatasetItem[]; cu: number }> {
  // actor id vem como "user/name" — codifica pra URL
  const encodedId = actorId.replace("/", "~");
  const url = `https://api.apify.com/v2/acts/${encodedId}/run-sync-get-dataset-items?token=${token}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`APIFY ${resp.status}: ${text.slice(0, 200)}`);
  }

  const items = (await resp.json()) as ApifyDatasetItem[];

  // CU vem em header opcional; alguns actors retornam so no /runs endpoint
  const cuHeader = resp.headers.get("x-apify-compute-units");
  const cu = cuHeader ? parseFloat(cuHeader) : estimateCu(items);
  return { items, cu };
}

/** Fallback pra estimar CU quando header nao vem. Muito grosseiro. */
function estimateCu(items: ApifyDatasetItem[]): number {
  // heuristica: 1 CU por 100 items ate 3 CU maximo
  return Math.min(3, Math.max(0.1, items.length / 100));
}

// ---- Main handler ----

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  // 1. Auth
  const auth = await authenticateRequest(req);
  if ("error" in auth) {
    return json({ error: auth.error }, auth.status);
  }
  const { userId, supa } = auth;

  // 2. Body
  let body: ApifyRequestBody;
  try {
    body = (await req.json()) as ApifyRequestBody;
  } catch {
    return json({ error: "invalid json body" }, 400);
  }
  if (!body.workspace_id || !body.actor_id || !body.input) {
    return json(
      { error: "missing required: workspace_id, actor_id, input" },
      400
    );
  }
  if (!ALLOWED_ACTORS.has(body.actor_id)) {
    return json({ error: `actor not allowed: ${body.actor_id}` }, 403);
  }

  // 3. Autoriza workspace
  const ok = await checkWorkspaceAccess(supa, body.workspace_id, userId);
  if (!ok) return json({ error: "workspace not accessible" }, 403);

  // 4. Cache lookup (a menos que bypass)
  const cacheKey = await sha256(
    body.actor_id + "|" + stableStringify(body.input) + "|" + body.workspace_id
  );

  const cacheTtlMs = body.cache_ttl_ms ?? CACHE_TTL_MS_DEFAULT;

  if (!body.bypass_cache) {
    const { data: cached } = await supa
      .from("apify_cache")
      .select("items, cost_usd, cu_used, fetched_at, expires_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (
      cached &&
      new Date((cached as { expires_at: string }).expires_at).getTime() >
        Date.now()
    ) {
      // Registra hit pra auditoria
      await supa.from("apify_runs").insert({
        workspace_id: body.workspace_id,
        user_id: userId,
        channel: "linkedin",
        actor_id: body.actor_id,
        input_hash: cacheKey,
        cu_used: 0,
        cost_usd: 0,
        cached: true,
        items_returned: Array.isArray((cached as { items: unknown[] }).items)
          ? (cached as { items: unknown[] }).items.length
          : 0,
      });
      return json({
        items: (cached as { items: unknown[] }).items,
        cached: true,
        cost: {
          cu: 0,
          usd: 0,
        },
        fetched_at: (cached as { fetched_at: string }).fetched_at,
      });
    }
  }

  // 5. Quota check
  const dailyCount = await getDailyRunCount(supa, body.workspace_id);
  if (dailyCount >= DAILY_RUN_LIMIT_HARD) {
    return json(
      {
        error: "daily_limit_exceeded",
        message: `Workspace bateu no teto diario de ${DAILY_RUN_LIMIT_HARD} runs APIFY.`,
        daily_count: dailyCount,
      },
      429
    );
  }

  // 6. Roda APIFY.
  // V5.3: se o client passou apify_token no body (override pessoal do profile),
  // usa esse. Caso contrario, fallback pro secret server-side padrao do time.
  // Nunca logamos o valor da chave — nem em erro. E fazemos trim + reject
  // string vazia pra nao mandar "?token=" invalido.
  const userToken =
    typeof body.apify_token === "string" ? body.apify_token.trim() : "";
  const serverToken = Deno.env.get("APIFY_TOKEN") ?? "";
  const apifyToken = userToken || serverToken;
  if (!apifyToken) {
    return json(
      { error: "APIFY_TOKEN nao configurado (sem secret server-side nem chave no profile)" },
      500
    );
  }
  const tokenSource = userToken ? "user" : "server";
  console.log(`[apify-fetch] using APIFY token from: ${tokenSource}`);

  let items: ApifyDatasetItem[] = [];
  let cu = 0;
  let apifyError: string | null = null;
  const t0 = Date.now();
  try {
    console.log(
      `[apify-fetch] START actor=${body.actor_id} input=${JSON.stringify(body.input).slice(0, 200)}`
    );
    const result = await runApifyActorSync(body.actor_id, body.input, apifyToken);
    items = result.items;
    cu = result.cu;
    console.log(
      `[apify-fetch] OK actor=${body.actor_id} items=${items.length} cu=${cu} took=${Date.now() - t0}ms`
    );
  } catch (e) {
    apifyError = (e as Error).message;
    // V5.1: log verboso pra debug — Supabase Logs vai mostrar o motivo real
    console.error(
      `[apify-fetch] FAIL actor=${body.actor_id} took=${Date.now() - t0}ms err=${apifyError}`
    );
  }

  // Actors pay-per-result não devem usar a heurística de Compute Units.
  const usdPerResult = ACTOR_USD_PER_RESULT[body.actor_id];
  const costUsd =
    usdPerResult !== undefined
      ? items.length * usdPerResult
      : cu *
        parseFloat(
          Deno.env.get("APIFY_USD_PER_CU") ?? String(USD_PER_CU_DEFAULT)
        );

  // 7. Registra run (mesmo em erro, pra ver padrao)
  await supa.from("apify_runs").insert({
    workspace_id: body.workspace_id,
    user_id: userId,
    channel: "linkedin",
    actor_id: body.actor_id,
    input_hash: cacheKey,
    cu_used: cu,
    cost_usd: costUsd,
    cached: false,
    items_returned: items.length,
    error: apifyError,
  });

  if (apifyError) {
    return json({ error: "apify_failed", detail: apifyError }, 502);
  }

  // 8. Cacheia — SO se APIFY retornou items reais.
  // V5.3.2: nunca cachear resposta vazia. Cache negativo (`items=[]`) preso
  // por 24h fazia refresh subsequente servir vazio sem re-consultar APIFY —
  // usuario clicava "atualizar" e nada acontecia. Se items.length === 0,
  // proximo refresh tenta de novo (custa 1 chamada APIFY, mas cache negativo
  // e pior porque esconde o problema).
  if (items.length > 0) {
    await supa.from("apify_cache").upsert(
      {
        cache_key: cacheKey,
        workspace_id: body.workspace_id,
        channel: "linkedin",
        actor_id: body.actor_id,
        items: items,
        cu_used: cu,
        cost_usd: costUsd,
        items_count: items.length,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + cacheTtlMs).toISOString(),
      },
      { onConflict: "cache_key" }
    );
  } else {
    console.log(
      `[apify-fetch] items=0, nao cacheando (evita cache negativo)`
    );
  }

  return json({
    items,
    cached: false,
    cost: { cu, usd: costUsd },
    fetched_at: new Date().toISOString(),
  });
});
