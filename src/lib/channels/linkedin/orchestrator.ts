// V5 — Orchestrator LinkedIn.
//
// Flow simplificado (comparado ao pipeline X): nao roda prefilter/scorer
// porque as bridges JA foram rankeadas pelo Groundswell offline. Apenas:
//   1. Fetch posts das bridges "ready + in_context" via APIFY (cache-first)
//   2. Enriquece cada post com bridge meta + top POI candidate (heuristica)
//   3. Retorna triage prep pronta pra UI
//
// Nao chama LLM na triage — o LLM entra so no reply generation (V5.1 wire).

import { LIMITS } from "../../constants";
import { supabase } from "../../supabase";
import {
  getActiveBridges,
  getActiveBundle,
  getBundleById,
  getPoiCandidatesForBridge,
} from "../../groundswell/storage";
import { linkedinAdapter } from ".";
import {
  upsertScrapedPosts,
  getRepliedPostUrns,
  getStoredPosts,
  type ScrapedPostInput,
} from "./scraped-posts";
import type {
  GroundswellBridge,
  GroundswellBundleSummary,
  PoiCandidate,
  RawPost,
} from "../types";

export interface LinkedInTriageItem {
  post: RawPost;
  bridge: GroundswellBridge & {
    linkedin_url?: string;
    public_identifier?: string;
  };
  suggestedPoi: PoiCandidate | null;
  poiCandidates: PoiCandidate[];
}

export interface LinkedInTriageOutcome {
  items: LinkedInTriageItem[];
  bundle: GroundswellBundleSummary;
  cached: boolean;
  cost: { cu: number; usd: number };
  fetchedAt: number;
  errors: string[];
  /** V5.1: contadores dos filtros aplicados — util pra debug quando items=[]. */
  stats: {
    rawPosts: number;
    filteredOld: number;
    filteredReposts: number;
    filteredNoText: number;
    filteredEngaged: number;
    windowHours: number;
  };
  /** V5.1: post_urns que ja tem reply persistida em linkedin_replies.
   *  Usado pra marcar cards com badge "respondido" mesmo apos reload. */
  repliedPostUrns: Set<string>;
}

/** Ultima semana por default. LinkedIn posts tem meia-vida longa — 1 semana
 *  cobre a maioria dos casos sem trazer historico velho. User pode ajustar
 *  em Settings > LinkedIn > Filtros + batch. */
const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

// V5.1: stats vazio pros early returns (bridge sem POI, etc)
function emptyStats(sinceMs: number): LinkedInTriageOutcome["stats"] {
  return {
    rawPosts: 0,
    filteredOld: 0,
    filteredReposts: 0,
    filteredNoText: 0,
    filteredEngaged: 0,
    windowHours: Math.round((Date.now() - sinceMs) / (60 * 60 * 1000)),
  };
}

export async function runLinkedInTriage(
  workspaceId: string,
  options?: {
    sinceMs?: number;
    maxItems?: number;
    /** V5.1: usa esse bundle especifico (lista selecionada). Se omitido,
     * usa fallback getActiveBundle (primeiro do workspace ou default do time). */
    bundleId?: string;
    /** V5.1: bypass do cache APIFY (12h por default). Custa mais mas
     * garante dados frescos — util quando cache velho esconde posts novos. */
    bypassCache?: boolean;
    /** V5.1: 'cache' = so le do store persistente (linkedin_scraped_posts),
     * $0 APIFY. 'refresh' = chama APIFY, upsert delta, depois le store.
     * Default = 'cache' (boot barato). Botao "atualizar" passa 'refresh'. */
    mode?: "cache" | "refresh";
    /** V5.3: token APIFY do profile (opcional). Passa pro edge function que
     *  usa em vez do secret server-side. */
    apifyToken?: string;
  }
): Promise<LinkedInTriageOutcome> {
  const errors: string[] = [];
  const sinceMs = options?.sinceMs ?? Date.now() - DEFAULT_LOOKBACK_MS;
  const maxItems = options?.maxItems ?? LIMITS.MAX_LLM_BATCH;
  const mode = options?.mode ?? "cache";

  // 1. Bundle: prioriza bundleId explicito da lista selecionada.
  const bundle = options?.bundleId
    ? await getBundleById(options.bundleId)
    : await getActiveBundle(workspaceId, "linkedin");
  if (!bundle) {
    throw new Error(
      "Nenhum bundle Groundswell ativo. Suba um em Settings ou use o bundle default do time."
    );
  }

  // 2. Bridges "ready + in_context" (+ emerging desde V5.1)
  const allBridges = await getActiveBridges(bundle.id);
  if (allBridges.length === 0) {
    return {
      items: [],
      bundle,
      cached: mode === "cache",
      cost: { cu: 0, usd: 0 },
      fetchedAt: Date.now(),
      errors: ["nenhuma bridge ready/emerging + in_context no bundle"],
      stats: emptyStats(sinceMs),
      repliedPostUrns: new Set(),
    };
  }

  // V5.3.2: pre-filter POI REMOVIDO.
  //
  // Antes: bundles Groundswell descartavam bridges sem POI mapeado nas
  // relationships ANTES do APIFY (economia $$). Assumia que o exporter
  // Groundswell classico mapeava POI target pra toda bridge relevante.
  //
  // No exporter novo (2026-07+), o modelo POI mudou — no bundle de teste
  // apenas 1 das 41 bridges (2%) tinha POI mapeado. Isso descartava 40
  // bridges antes do fetch, quebrando o feed inteiro.
  //
  // Novo comportamento: TODAS as bridges do bundle vao pro APIFY. Se a
  // bridge nao tem POI candidates no `getPoiCandidatesForBridge`, o reply
  // flow ja usa `buildLinkedInDirectSystemPrompt` (fluxo "direto ao autor",
  // adicionado na V5.2 pra listas manuais). Same UX, sem descartes silenciosos.
  //
  // Custo trade-off: era $0.25/bridge sem POI. Com tiered posts (V5.3.2)
  // uma bridge not_yet custa 1 post × $0.005 = $0.005 (50x mais barato).
  // Economia perdida no bundle de teste: ~$0.15/refresh — desprezivel.
  const isManual = bundle.source === "manual";
  const bridges = allBridges;
  const bridgesById = new Map(bridges.map((b) => [b.bridge_id, b]));

  // ============================================================================
  // 3. Fetch APIFY (SO se mode='refresh') + upsert em linkedin_scraped_posts
  // ============================================================================
  let rawPostsCount = 0;
  let apifyCost = { cu: 0, usd: 0 };
  let apifyCached = false;
  let filteredReposts = 0;
  let filteredNoText = 0;
  let filteredOld = 0;

  if (mode === "refresh") {
    // V5.3.2: posts/bridge tiered por readiness_tier (economia de custo APIFY).
    // - ready       → 5 posts (sinal alto, vale ver historico recente)
    // - promising/emerging → 3 posts (sinal medio, cobertura suficiente)
    // - not_yet/needs_work → 1 post (baixo sinal, so pra saber se acordou)
    // Custo aproximado (bundle de teste, 41 bridges): 5×5 + 10×3 + 26×1 = 81 posts
    // × $0.005 = ~$0.40 por refresh (era $2 com 10 fixo, $1 com 5 fixo).
    const postsFor = (tier?: string | null): number => {
      if (tier === "ready") return 5;
      if (tier === "promising" || tier === "emerging") return 3;
      return 1; // not_yet, needs_work, ou qualquer outro
    };
    const bridgeTargets = bridges
      .map((b) => {
        const url =
          b.linkedin_url ??
          (b.public_identifier
            ? `https://www.linkedin.com/in/${b.public_identifier}`
            : undefined);
        if (!url) return null;
        return { url, postsLimit: postsFor(b.readiness_tier) };
      })
      .filter((t): t is { url: string; postsLimit: number } => t !== null);

    const fetchResult = await linkedinAdapter.fetchPosts(
      {
        workspace_id: workspaceId,
        bundle_id: bundle.id,
        apify_token: options?.apifyToken,
      },
      {
        sinceMs,
        cache: options?.bypassCache ? "bypass" : "prefer",
        bridgeTargets,
      }
    );
    rawPostsCount = fetchResult.posts.length;
    apifyCost = {
      cu: fetchResult.cost?.cu ?? 0,
      usd: fetchResult.cost?.usd ?? 0,
    };
    apifyCached = fetchResult.cached;

    // V5.3.2: filtros simplificados por pedido do user.
    // Antes: dedup + janela + repost + text<20 + match-bridge.
    // Agora: SO dedup + janela + match-bridge. Reposts, quotes, articles, jobs
    // e posts curtos passam — o card ganhou tags visuais por tipo pra deixar
    // claro pro user (ex: [repost], [quote], [artigo], [sem texto]).
    // Os counters filteredReposts/filteredNoText continuam sendo populados
    // pra info no diagnostico, mas nao filtram mais nada.
    const toUpsert: ScrapedPostInput[] = [];
    const seen = new Set<string>();
    for (const post of fetchResult.posts) {
      if (seen.has(post.post_ref)) continue;
      seen.add(post.post_ref);
      const createdMs = post.created_at ? Date.parse(post.created_at) : NaN;
      if (!Number.isFinite(createdMs) || createdMs < sinceMs) {
        filteredOld++;
        continue;
      }
      // Counters info-only (nao filtram) — pra transparencia no painel diag.
      if (post.post_type === "repost") filteredReposts++;
      if (!post.text || post.text.trim().length < 20) filteredNoText++;

      const bridge = matchBridge(post, bridges, bridgesById);
      if (!bridge) continue;
      toUpsert.push({ post, bridgeId: bridge.bridge_id });
    }
    await upsertScrapedPosts(workspaceId, bundle.id, toUpsert);
    console.log(
      `[linkedin] refresh: apify raw=${rawPostsCount}, upserted=${toUpsert.length}`
    );
  }

  // ============================================================================
  // 4. Query store (SEMPRE) — fonte da verdade. Posts persistidos aparecem
  //    mesmo em mode='cache' (sem chamar APIFY).
  // ============================================================================
  const stored = await getStoredPosts(workspaceId, bundle.id, sinceMs);
  const items: LinkedInTriageItem[] = [];
  const seenPostRefs = new Set<string>();
  const poiCache = new Map<string, PoiCandidate[]>();

  for (const { post, bridgeId } of stored) {
    if (items.length >= maxItems) break;
    if (seenPostRefs.has(post.post_ref)) continue;
    seenPostRefs.add(post.post_ref);

    // Bridge tem que existir no bundle atual (pode nao existir se bundle mudou)
    const bridge = bridgesById.get(bridgeId);
    if (!bridge) continue;

    // V5.2: listas manuais nao tem POI candidates — pula lookup completamente.
    // Reply flow trata `poiCandidates=[]` + `suggestedPoi=null` como "direto ao autor".
    let poiCandidates = poiCache.get(bridgeId);
    if (!poiCandidates) {
      if (isManual) {
        poiCandidates = [];
      } else {
        try {
          poiCandidates = await getPoiCandidatesForBridge(
            bundle.id,
            bridgeId,
            5
          );
        } catch (e) {
          errors.push(
            `POI lookup falhou pra ${bridge.name}: ${(e as Error).message}`
          );
          poiCandidates = [];
        }
      }
      poiCache.set(bridgeId, poiCandidates);
    }

    items.push({
      post,
      bridge,
      suggestedPoi: poiCandidates[0] ?? null,
      poiCandidates,
    });
  }

  // Post_urns com reply persistida — usa pra ordenar (respondidos no fim) + UI
  const repliedPostUrns = await getRepliedPostUrns(workspaceId);
  items.sort((a, b) => {
    const aReplied = repliedPostUrns.has(a.post.post_ref) ? 1 : 0;
    const bReplied = repliedPostUrns.has(b.post.post_ref) ? 1 : 0;
    if (aReplied !== bReplied) return aReplied - bReplied;
    const aTs = Date.parse(a.post.created_at ?? "") || 0;
    const bTs = Date.parse(b.post.created_at ?? "") || 0;
    return bTs - aTs;
  });

  // Engaged count (posts ja engajados — separado de replied, historico local)
  const engaged = await fetchEngagedPostUrns(workspaceId);
  const engagedCount = items.filter((it) => engaged.has(it.post.post_ref))
    .length;

  console.log(
    `[linkedin] mode=${mode}, stored=${stored.length}, items=${items.length}, ` +
      `filtered(refresh only)=old:${filteredOld} reposts:${filteredReposts} no_text:${filteredNoText}`
  );

  return {
    items,
    bundle,
    cached: mode === "cache" || apifyCached,
    cost: apifyCost,
    fetchedAt: Date.now(),
    errors,
    stats: {
      rawPosts: rawPostsCount,
      filteredOld,
      filteredReposts,
      filteredNoText,
      filteredEngaged: engagedCount,
      windowHours: Math.round((Date.now() - sinceMs) / (60 * 60 * 1000)),
    },
    repliedPostUrns,
  };
}

// ---- Helpers ----

/**
 * Tenta casar o post com uma bridge pela ordem:
 *  1. fetched_via_profile (se o actor propagar) match com bridge.linkedin_url
 *  2. author_handle == public_identifier
 *  3. author_handle contido no linkedin_url
 */
function matchBridge(
  post: RawPost,
  bridges: Array<GroundswellBridge & { linkedin_url?: string; public_identifier?: string }>,
  _byId: Map<string, GroundswellBridge>
): (GroundswellBridge & { linkedin_url?: string; public_identifier?: string }) | undefined {
  const via = post.fetched_via_profile;
  if (via) {
    const norm = normalizeLinkedInUrl(via);
    const match = bridges.find(
      (b) => b.linkedin_url && normalizeLinkedInUrl(b.linkedin_url) === norm
    );
    if (match) return match;
  }

  const handle = post.author_handle;
  if (handle) {
    const byIdentifier = bridges.find(
      (b) => b.public_identifier && handle.includes(b.public_identifier)
    );
    if (byIdentifier) return byIdentifier;

    const byUrl = bridges.find((b) =>
      b.linkedin_url?.toLowerCase().includes(handle.toLowerCase())
    );
    if (byUrl) return byUrl;
  }

  return undefined;
}

function normalizeLinkedInUrl(url: string): string {
  return url
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "")
    .replace(/\/$/, "");
}

async function fetchEngagedPostUrns(workspaceId: string): Promise<Set<string>> {
  try {
    const { data, error } = await supabase
      .from("linkedin_engaged_posts")
      .select("post_urn")
      .eq("workspace_id", workspaceId);
    if (error) return new Set();
    return new Set((data ?? []).map((r) => (r as { post_urn: string }).post_urn));
  } catch {
    return new Set();
  }
}
