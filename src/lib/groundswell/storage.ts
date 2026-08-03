// V5 â€” Persist Groundswell bundle no Supabase.
//
// Upsert em lotes (batches de 500 rows) pra evitar timeout / limite de payload.
// Transacional-ish: primeiro upsert do bundle (root), depois filhas com FK.
// Se der erro no meio, root fica com estado parcial â€” user pode re-tentar.
//
// Estrategia "so 1 ativo por workspace+channel" e enforced no server via
// trigger (ver 0009_groundswell_v5.sql -> enforce_single_active_bundle).

import { getSession } from "../auth";
import { supabase } from "../supabase";
import type {
  Channel,
  GroundswellBundle,
  GroundswellBundleSummary,
  GroundswellBridge,
  GroundswellInteraction,
  GroundswellProfile,
  GroundswellSourceProfile,
  PoiCandidate,
} from "../channels/types";
import { summarizeBundle } from "./bundle-parser";

const BATCH_SIZE = 500;

async function insertInBatches(
  table: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    // supabase-js insert nao aceita generico bem â€” cast pra unknown pra silenciar
    const { error } = await supabase
      .from(table)
      .insert(batch as unknown as never);
    if (error) throw error;
  }
}

export interface UploadOptions {
  workspaceId: string | null;         // null quando e bundle default do time
  channel: Channel;
  isDefault?: boolean;                 // so admin pode setar true (RLS)
  /** V5.1: nome da lista. Se ausente, usa workspace_slug ou 'Lista principal' */
  name?: string;
  onProgress?: (step: string, done: number, total: number) => void;
}

/**
 * Upload de bundle: cria row em groundswell_bundles + insert em batch pras filhas.
 * Retorna o UUID do bundle criado.
 */
export async function uploadBundle(
  bundle: GroundswellBundle,
  opts: UploadOptions
): Promise<string> {
  const session = await getSession();
  if (!session?.user) throw new Error("Nao autenticado");

  // V5.1: nome da lista. Prioridade: opts.name > workspace_slug > 'Lista principal'.
  const bundleName =
    opts.name?.trim() ||
    bundle.workspace_slug?.trim() ||
    "Lista principal";

  const { data: bundleRow, error: bundleErr } = await supabase
    .from("groundswell_bundles")
    .insert({
      workspace_id: opts.workspaceId,
      uploaded_by: session.user.id,
      channel: opts.channel,
      source: "groundswell",
      name: bundleName,
      workspace_slug: bundle.workspace_slug,
      delivery_date: bundle.delivery_date,
      latest_engagement_date: bundle.latest_engagement_date,
      manifest: bundle.manifest,
      cohort_summary: bundle.cohort_summary,
      brand_radar: bundle.brand_radar,
      is_default: Boolean(opts.isDefault),
      is_active: true,
    })
    .select("id")
    .single();
  if (bundleErr) throw bundleErr;
  const bundleId = (bundleRow as { id: string }).id;

  const report = (step: string, done: number, total: number) =>
    opts.onProgress?.(step, done, total);

  // profiles
  report("perfis", 0, bundle.profiles.length);
  await insertInBatches(
    "groundswell_profiles",
    bundle.profiles.map((p) => ({
      bundle_id: bundleId,
      profile_id: p.profile_id,
      name: p.name,
      node_type: p.node_type,
      public_identifier: p.public_identifier,
      linkedin_url: p.linkedin_url,
      headline: p.headline,
      current_company: p.current_company,
      current_position: p.current_position,
      followers: p.followers,
      is_poi: p.is_poi,
      tracked_layer: p.tracked_layer,
      inferred_layer: p.inferred_layer,
      pagerank: p.pagerank,
      distinct_source_count: p.distinct_source_count,
      pagerank_adjusted: p.pagerank_adjusted,
      hits_authority: p.hits_authority,
      influence_surplus: p.influence_surplus,
      followers_percentile: p.followers_percentile,
      pagerank_adjusted_percentile: p.pagerank_adjusted_percentile,
      hits_authority_percentile: p.hits_authority_percentile,
      authority_consensus_percentile: p.authority_consensus_percentile,
      influence_surplus_percentile: p.influence_surplus_percentile,
      isv: p.isv,
      computed_at: p.computed_at,
    }))
  );
  report("perfis", bundle.profiles.length, bundle.profiles.length);

  // bridges
  report("conexoes", 0, bundle.bridges.length);
  await insertInBatches(
    "groundswell_bridges",
    bundle.bridges.map((b) => ({ bundle_id: bundleId, ...b }))
  );
  report("conexoes", bundle.bridges.length, bundle.bridges.length);

  // relationships
  report("relacoes", 0, bundle.relationships.length);
  await insertInBatches(
    "groundswell_relationships",
    bundle.relationships.map((r) => ({ bundle_id: bundleId, ...r }))
  );
  report(
    "relacoes",
    bundle.relationships.length,
    bundle.relationships.length
  );

  // interactions
  report("interacoes", 0, bundle.interactions.length);
  await insertInBatches(
    "groundswell_interactions",
    bundle.interactions.map((i) => ({ bundle_id: bundleId, ...i }))
  );
  report(
    "interacoes",
    bundle.interactions.length,
    bundle.interactions.length
  );

  // source_profiles
  report("fontes", 0, bundle.source_profiles.length);
  await insertInBatches(
    "groundswell_source_profiles",
    bundle.source_profiles.map((s) => ({ bundle_id: bundleId, ...s }))
  );
  report(
    "fontes",
    bundle.source_profiles.length,
    bundle.source_profiles.length
  );

  return bundleId;
}

/**
 * V5.2 â€” Upload de lista MANUAL (CSV padrÃ£o de prospecÃ§Ã£o) como bundle
 * "leve" no mesmo schema `groundswell_bundles`. Sem POIs, sem relacionamentos,
 * sem scoring. Reuso total do wiring existente (dropdown Header, dedup por
 * bundle_id, apify_cache por-bridge, linkedin_scraped_posts, etc).
 *
 * Bridges criadas com `readiness_tier='ready' + context_fit='in_context'`
 * pra satisfazer o filtro de `getActiveBridges` sem escrever query alternativa.
 * O orchestrator diferencia via `bundle.source === 'manual'` e pula POI
 * candidates â†’ reply-generator usa prompt "direto ao autor" (sem POI-target).
 */
export interface ManualListRow {
  name: string;
  linkedin_url: string;
  public_identifier?: string;
  headline?: string;
  current_company?: string;
}

export async function uploadManualList(
  rows: ManualListRow[],
  opts: { workspaceId: string; name: string }
): Promise<string> {
  const session = await getSession();
  if (!session?.user) throw new Error("Nao autenticado");
  if (rows.length === 0) throw new Error("CSV vazio â€” precisa ao menos 1 linha");

  const bundleName = opts.name.trim() || "Lista manual";

  const { data: bundleRow, error: bundleErr } = await supabase
    .from("groundswell_bundles")
    .insert({
      workspace_id: opts.workspaceId,
      uploaded_by: session.user.id,
      channel: "linkedin",
      source: "manual",
      name: bundleName,
      workspace_slug: null,
      manifest: null,
      is_default: false,
      is_active: true,
    })
    .select("id")
    .single();
  if (bundleErr) throw bundleErr;
  const bundleId = (bundleRow as { id: string }).id;

  // Cada linha vira profile + bridge com scores null. profile_id derivado
  // determinista (hash da URL) evita conflito com uploads futuros da mesma lista.
  const profileRows = rows.map((r) => {
    const publicId =
      r.public_identifier ??
      extractPublicIdentifier(r.linkedin_url) ??
      hashUrl(r.linkedin_url);
    const profileId = `manual-${publicId}`;
    return { profileId, publicId, row: r };
  });

  await insertInBatches(
    "groundswell_profiles",
    profileRows.map(({ profileId, publicId, row }) => ({
      bundle_id: bundleId,
      profile_id: profileId,
      name: row.name,
      node_type: "profile",
      public_identifier: publicId,
      linkedin_url: row.linkedin_url,
      headline: row.headline ?? null,
      current_company: row.current_company ?? null,
      is_poi: false,
    }))
  );

  await insertInBatches(
    "groundswell_bridges",
    profileRows.map(({ profileId, row }) => ({
      bundle_id: bundleId,
      bridge_id: profileId,
      name: row.name,
      headline: row.headline ?? null,
      current_company: row.current_company ?? null,
      context_fit: "in_context",
      readiness_tier: "ready",
      rationale: "Lista manual",
    }))
  );

  return bundleId;
}

/** Extrai public_identifier de URL LinkedIn (mesmo regex do adapter). */
function extractPublicIdentifier(url: string): string | undefined {
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? m[1] : undefined;
}

/** Fallback: hash curto quando URL nao tem `/in/handle` reconhecivel. */
function hashUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = (h << 5) - h + url.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36).slice(0, 10);
}

/**
 * Retorna o bundle ativo pra um (workspace, channel). Ordem de prioridade:
 *  1. bundle onde workspace_id == p_workspaceId e is_active
 *  2. bundle default (is_default = true) do mesmo channel
 *  3. null
 */
export async function getActiveBundle(
  workspaceId: string,
  channel: Channel
): Promise<GroundswellBundleSummary | null> {
  // primeiro tenta bundle do workspace
  const { data: own, error: e1 } = await supabase
    .from("groundswell_bundles")
    .select(
      "id, name, source, workspace_slug, delivery_date, latest_engagement_date, channel, is_default, is_active, uploaded_at"
    )
    .eq("workspace_id", workspaceId)
    .eq("channel", channel)
    .eq("is_active", true)
    .maybeSingle();
  if (e1) throw e1;

  let row = own as
    | (Omit<GroundswellBundleSummary, "n_profiles" | "n_pois" | "n_bridges" | "n_bridges_ready" | "n_relationships" | "n_interactions">)
    | null;

  if (!row) {
    // fallback pro default do time
    const { data: def, error: e2 } = await supabase
      .from("groundswell_bundles")
      .select(
        "id, name, source, workspace_slug, delivery_date, latest_engagement_date, channel, is_default, is_active, uploaded_at"
      )
      .eq("channel", channel)
      .eq("is_default", true)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (e2) throw e2;
    row = def as typeof row;
  }

  if (!row) return null;

  // conta rows das filhas (queries baratas)
  const [profiles, bridges, rels, intx] = await Promise.all([
    supabase
      .from("groundswell_profiles")
      .select("is_poi", { count: "exact", head: false })
      .eq("bundle_id", row.id),
    supabase
      .from("groundswell_bridges")
      .select("readiness_tier, context_fit", { count: "exact", head: false })
      .eq("bundle_id", row.id),
    supabase
      .from("groundswell_relationships")
      .select("source_id", { count: "exact", head: true })
      .eq("bundle_id", row.id),
    supabase
      .from("groundswell_interactions")
      .select("source_id", { count: "exact", head: true })
      .eq("bundle_id", row.id),
  ]);

  const profilesData = (profiles.data ?? []) as Array<{ is_poi: boolean }>;
  const bridgesData = (bridges.data ?? []) as Array<{
    readiness_tier: string;
    context_fit: string;
  }>;

  return {
    id: row.id,
    name: row.name ?? row.workspace_slug ?? "Lista principal",
    source: (row.source as "groundswell" | "manual") ?? "groundswell",
    workspace_slug: row.workspace_slug,
    delivery_date: row.delivery_date,
    latest_engagement_date: row.latest_engagement_date,
    channel: row.channel,
    is_default: row.is_default,
    is_active: row.is_active,
    uploaded_at: row.uploaded_at,
    n_profiles: profiles.count ?? profilesData.length,
    n_pois: profilesData.filter((p) => p.is_poi).length,
    n_bridges: bridges.count ?? bridgesData.length,
    n_bridges_ready: bridgesData.filter(
      (b) => b.readiness_tier === "ready" && b.context_fit === "in_context"
    ).length,
    n_relationships: rels.count ?? 0,
    n_interactions: intx.count ?? 0,
  };
}

/**
 * V5.1: Retorna 1 bundle especifico por id. Usado quando user seleciona uma
 * "lista" pelo dropdown Header â€” precisamos do bundle escolhido, nao do
 * primeiro ativo. Se nao encontrar (id inexistente ou sem permissao), retorna null.
 */
export async function getBundleById(
  bundleId: string
): Promise<GroundswellBundleSummary | null> {
  const { data, error } = await supabase
    .from("groundswell_bundles")
    .select(
      "id, name, source, workspace_slug, delivery_date, latest_engagement_date, channel, is_default, is_active, uploaded_at"
    )
    .eq("id", bundleId)
    .maybeSingle();
  if (error) throw error;
  const row = data as {
    id: string;
    name: string | null;
    source: "groundswell" | "manual" | null;
    workspace_slug: string;
    delivery_date: string;
    latest_engagement_date: string;
    channel: Channel;
    is_default: boolean;
    is_active: boolean;
    uploaded_at: string;
  } | null;
  if (!row) return null;

  const [profiles, bridges, rels, intx] = await Promise.all([
    supabase
      .from("groundswell_profiles")
      .select("is_poi", { count: "exact", head: false })
      .eq("bundle_id", row.id),
    supabase
      .from("groundswell_bridges")
      .select("readiness_tier, context_fit", { count: "exact", head: false })
      .eq("bundle_id", row.id),
    supabase
      .from("groundswell_relationships")
      .select("source_id", { count: "exact", head: true })
      .eq("bundle_id", row.id),
    supabase
      .from("groundswell_interactions")
      .select("source_id", { count: "exact", head: true })
      .eq("bundle_id", row.id),
  ]);

  const profilesData = (profiles.data ?? []) as Array<{ is_poi: boolean }>;
  const bridgesData = (bridges.data ?? []) as Array<{
    readiness_tier: string;
    context_fit: string;
  }>;

  return {
    id: row.id,
    name: row.name ?? row.workspace_slug ?? "Lista principal",
    source: (row.source as "groundswell" | "manual") ?? "groundswell",
    workspace_slug: row.workspace_slug,
    delivery_date: row.delivery_date,
    latest_engagement_date: row.latest_engagement_date,
    channel: row.channel,
    is_default: row.is_default,
    is_active: row.is_active,
    uploaded_at: row.uploaded_at,
    n_profiles: profiles.count ?? profilesData.length,
    n_pois: profilesData.filter((p) => p.is_poi).length,
    n_bridges: bridges.count ?? bridgesData.length,
    n_bridges_ready: bridgesData.filter(
      (b) => b.readiness_tier === "ready" && b.context_fit === "in_context"
    ).length,
    n_relationships: rels.count ?? 0,
    n_interactions: intx.count ?? 0,
  };
}

/**
 * V5.1: Lista TODOS os bundles ativos por (workspace, channel).
 * Suporta "listas" â€” user alterna qual bundle esta em uso via dropdown Header.
 * Migration 0011 relaxou constraint pra permitir N ativos por par.
 *
 * Retorna sem os counts pra ser barato â€” chamador que precisa dos numeros
 * usa getActiveBundle(id) ou uma query dedicada.
 *
 * Ordem: uploaded_at DESC (mais recente primeiro).
 */
export async function listActiveBundles(
  workspaceId: string,
  channel: Channel
): Promise<
  Array<
    Pick<
      GroundswellBundleSummary,
      | "id"
      | "name"
      | "source"
      | "workspace_slug"
      | "delivery_date"
      | "latest_engagement_date"
      | "channel"
      | "is_default"
      | "is_active"
      | "uploaded_at"
    >
  >
> {
  const { data, error } = await supabase
    .from("groundswell_bundles")
    .select(
      "id, name, source, workspace_slug, delivery_date, latest_engagement_date, channel, is_default, is_active, uploaded_at"
    )
    .eq("workspace_id", workspaceId)
    .eq("channel", channel)
    .eq("is_active", true)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...(row as {
      id: string;
      name: string | null;
      source: "groundswell" | "manual" | null;
      workspace_slug: string;
      delivery_date: string;
      latest_engagement_date: string;
      channel: Channel;
      is_default: boolean;
      is_active: boolean;
      uploaded_at: string;
    }),
    name: row.name ?? row.workspace_slug ?? "Lista principal",
    source: (row.source as "groundswell" | "manual") ?? "groundswell",
  }));
}

/** V5.3.2: renomear uma lista/bundle. RLS filtra so bundles do proprio user
 *  (via workspace ownership). Nao mexe nos dados filhos (profiles/bridges/etc). */
export async function renameBundle(
  bundleId: string,
  newName: string
): Promise<void> {
  const clean = newName.trim();
  if (!clean) throw new Error("Nome nao pode ficar vazio");
  const { error } = await supabase
    .from("groundswell_bundles")
    .update({ name: clean })
    .eq("id", bundleId);
  if (error) throw error;
}

/** V5.3.2: excluir uma lista/bundle. Soft-delete via is_active=false.
 *  Preserva o registro pra retro-compat com replies antigas que referenciam
 *  bundle_id (nao quebra historico). Fica escondido dos dropdowns/queries
 *  que filtram por is_active=true. */
export async function deleteBundle(bundleId: string): Promise<void> {
  const { error } = await supabase
    .from("groundswell_bundles")
    .update({ is_active: false })
    .eq("id", bundleId);
  if (error) throw error;
}

/** Lista bridges "ready + in_context" â€” watchlist principal do canal LinkedIn.
 *
 * V5.0.1 (bugfix): antes tentava `groundswell_profiles!inner` mas nao ha FK
 * declarado entre bridges e profiles (ambos so tem FK pra bundles + bridge_id
 * casa com profile_id semanticamente). Faz 2 queries e merge no client.
 */
export async function getActiveBridges(
  bundleId: string
): Promise<
  Array<
    GroundswellBridge & {
      linkedin_url?: string;
      public_identifier?: string;
    }
  >
> {
  // V5.3.2: aceita TODAS as bridges exceto as marcadas como "fora do ICP".
  //
  // Evolucao dos filtros:
  //   V5.0 → readiness=ready + context=in_context (2 valores possiveis)
  //   V5.1 → readiness IN (ready, emerging) + context=in_context (~5 bridges no bundle de teste)
  //   V5.3.2 → aceita qualquer readiness + context IN (in_context, adjacent, out_of_context)
  //           rejeita apenas context=off_context (novo valor do exporter)
  //
  // Motivo: o exporter novo introduziu vocabulario novo (promising, not_yet,
  // adjacent, off_context). Filtrar por whitelist rigida perdia bridges
  // validas de bundles novos. Agora: whitelist rigida SO pro que o exporter
  // declara explicitamente "nao mira" (context_fit=off_context). Tudo mais
  // passa, ordenado por readiness_score DESC — melhores sinais no topo,
  // usuario decide manualmente quais quer comentar.
  //
  // Legacy: aceita 'out_of_context' (V5.0/V5.1) alem de todos os fits novos.
  const { data: bridgeRows, error: brErr } = await supabase
    .from("groundswell_bridges")
    .select(
      `bridge_id, name, headline, current_company,
       context_fit, readiness_score, readiness_tier,
       profile_fit_score, voice_quality_score, proximity_score, audience_score,
       rationale, n_interactions, n_comments, analyzed_at, model`
    )
    .eq("bundle_id", bundleId)
    .neq("context_fit", "off_context")
    .order("readiness_score", { ascending: false, nullsFirst: false });
  if (brErr) throw brErr;

  const bridges = (bridgeRows ?? []) as GroundswellBridge[];
  if (bridges.length === 0) return [];

  // Puxa so os profiles relevantes â€” bridge_id == profile_id no mesmo bundle
  const bridgeIds = bridges.map((b) => b.bridge_id);
  const { data: profileRows, error: pErr } = await supabase
    .from("groundswell_profiles")
    .select("profile_id, linkedin_url, public_identifier")
    .eq("bundle_id", bundleId)
    .in("profile_id", bridgeIds);
  if (pErr) throw pErr;

  const profileMap = new Map<
    string,
    { linkedin_url?: string; public_identifier?: string }
  >();
  for (const p of (profileRows ?? []) as Array<{
    profile_id: string;
    linkedin_url?: string;
    public_identifier?: string;
  }>) {
    profileMap.set(p.profile_id, {
      linkedin_url: p.linkedin_url,
      public_identifier: p.public_identifier,
    });
  }

  return bridges.map((b) => ({
    ...b,
    linkedin_url: profileMap.get(b.bridge_id)?.linkedin_url,
    public_identifier: profileMap.get(b.bridge_id)?.public_identifier,
  }));
}

/** RPC: retorna top-N POIs candidatos pra uma bridge (heuristica no SQL) */
export async function getPoiCandidatesForBridge(
  bundleId: string,
  bridgeId: string,
  limit = 5
): Promise<PoiCandidate[]> {
  const { data, error } = await supabase.rpc("get_poi_candidates_for_bridge", {
    p_bundle_id: bundleId,
    p_bridge_id: bridgeId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as PoiCandidate[];
}

/** V5.0.3: batch query â€” retorna Set de bridge_ids que tem >=1 POI candidate.
 *  Usado pra pre-filtrar bridges ANTES do fetch APIFY (economia direta de custo). */
export async function getBridgesWithPois(
  bundleId: string,
  bridgeIds: string[]
): Promise<Set<string>> {
  if (bridgeIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("groundswell_relationships")
    .select(
      `source_id,
       target:groundswell_profiles!inner(profile_id, is_poi)`
    )
    .eq("bundle_id", bundleId)
    .in("source_id", bridgeIds);
  if (error) {
    // Fallback: se o join implicit nao funcionar (FK ausente), faz 2 queries
    return getBridgesWithPoisFallback(bundleId, bridgeIds);
  }
  const withPoi = new Set<string>();
  for (const row of (data ?? []) as Array<{
    source_id: string;
    target: { is_poi: boolean } | { is_poi: boolean }[];
  }>) {
    const target = Array.isArray(row.target) ? row.target[0] : row.target;
    if (target?.is_poi) withPoi.add(row.source_id);
  }
  return withPoi;
}

async function getBridgesWithPoisFallback(
  bundleId: string,
  bridgeIds: string[]
): Promise<Set<string>> {
  // Passo 1: pega todos os target_ids que as bridges referenciam
  const { data: rels, error: e1 } = await supabase
    .from("groundswell_relationships")
    .select("source_id, target_id")
    .eq("bundle_id", bundleId)
    .in("source_id", bridgeIds);
  if (e1 || !rels) return new Set();
  const targetIds = Array.from(
    new Set((rels as Array<{ target_id: string }>).map((r) => r.target_id))
  );
  if (targetIds.length === 0) return new Set();

  // Passo 2: filtra profiles que sao POI
  const { data: profiles, error: e2 } = await supabase
    .from("groundswell_profiles")
    .select("profile_id, is_poi")
    .eq("bundle_id", bundleId)
    .in("profile_id", targetIds)
    .eq("is_poi", true);
  if (e2 || !profiles) return new Set();
  const poiSet = new Set(
    (profiles as Array<{ profile_id: string }>).map((p) => p.profile_id)
  );

  // Passo 3: bridges que referenciam ao menos 1 target-POI
  const withPoi = new Set<string>();
  for (const r of rels as Array<{ source_id: string; target_id: string }>) {
    if (poiSet.has(r.target_id)) withPoi.add(r.source_id);
  }
  return withPoi;
}

/** Lookup interacoes historicas de uma bridge â€” usado pra colorir triage */
export async function getBridgeInteractionsSample(
  bundleId: string,
  bridgeId: string,
  limit = 10
): Promise<GroundswellInteraction[]> {
  const { data, error } = await supabase
    .from("groundswell_interactions")
    .select("*")
    .eq("bundle_id", bundleId)
    .eq("source_id", bridgeId)
    .order("date_utc", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as GroundswellInteraction[];
}

/** SourceProfile de uma bridge (topic distributions etc) â€” pra prompt */
export async function getSourceProfile(
  bundleId: string,
  sourceId: string
): Promise<GroundswellSourceProfile | null> {
  const { data, error } = await supabase
    .from("groundswell_source_profiles")
    .select("*")
    .eq("bundle_id", bundleId)
    .eq("source_id", sourceId)
    .maybeSingle();
  if (error) throw error;
  return (data as GroundswellSourceProfile | null) ?? null;
}

/** POI profile completo â€” pra display + prompt */
export async function getPoiProfile(
  bundleId: string,
  profileId: string
): Promise<GroundswellProfile | null> {
  const { data, error } = await supabase
    .from("groundswell_profiles")
    .select("*")
    .eq("bundle_id", bundleId)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw error;
  return (data as GroundswellProfile | null) ?? null;
}

// Reexport helper
export { summarizeBundle };

