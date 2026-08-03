// V5 — Parser do bundle Groundswell.
//
// Entrada: File (zip) ou objeto Record<filename, text> — pra fixtures de teste.
// Saida: GroundswellBundle tipado, pronto pra upsert no Supabase.
//
// V5.3.1: **classificacao por schema, nao por nome de arquivo**.
//
// Antes o parser dependia de sufixos (bridges_ai_ranked.csv, influence_ranking.csv,
// etc). Se o exporter renomeasse os arquivos, quebrava. Agora inspeciona o
// HEADER de cada CSV e compara com assinaturas distintivas — cada tipo de
// tabela tem um conjunto unico de colunas que so ela tem.
//
// Assinaturas por tipo (colunas obrigatorias):
//   bridges         → bridge_id + readiness_score + readiness_tier
//   profiles        → id + is_poi + pagerank
//   relationships   → source_id + target_id + relation_type + reciprocity
//   interactions    → date_utc + ref_type + post_id
//   source_profiles → source_id + n_authored_posts
//   brand_radar     → metric + value (exatamente 2 colunas)
//
// Fallback pro nome do arquivo (endsWith) se schema nao bater com nenhum tipo
// conhecido — mantem retro-compat com layouts antigos/exoticos.
//
// `advanced/` e ignorado (arquivos internos do exporter, nao consumimos).
// `manifest.json` continua sendo o source of truth pra workspace_slug +
// datas, mas se estiver ausente sintetizamos a partir do primeiro filename
// (best-effort — permite bundle "solto" pra debug local).

import { parseCsv, casts } from "./csv";
import type {
  ContextFit,
  GroundswellBridge,
  GroundswellBundle,
  GroundswellInteraction,
  GroundswellManifest,
  GroundswellProfile,
  GroundswellRelationship,
  GroundswellSourceProfile,
  Channel,
  ReadinessTier,
} from "../channels/types";

// ---- unzip minimalista via CompressionStream (Chrome MV3 tem native) ----
// Fallback: usa DecompressionStream (Chrome 80+, Edge 80+, MV3 sempre presente).

interface ZipEntry {
  name: string;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Le entries do zip usando a API nativa CompressionStream ("deflate-raw").
 * NAO usamos DecompressionStream direto porque zip tem central directory —
 * precisamos parsear o formato. Implementacao curta em JS puro.
 *
 * Suporta so metodos deflate (0x08) e store (0x00) — os unicos que
 * Groundswell exporter usa.
 */
async function readZip(file: Blob): Promise<ZipEntry[]> {
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // Localiza End of Central Directory (EOCD). Sig 0x06054b50 (LE).
  // Escaneia de tras pra frente (EOCD fica no final).
  let eocdOffset = -1;
  const maxSearch = Math.min(bytes.length, 65_557);
  for (let i = bytes.length - 22; i >= bytes.length - maxSearch && i >= 0; i--) {
    if (
      view.getUint32(i, true) === 0x06054b50
    ) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Zip invalido: EOCD nao encontrado");

  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);

  const entries: ZipEntry[] = [];
  let ptr = cdOffset;
  for (let e = 0; e < totalEntries; e++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) {
      throw new Error(`Zip invalido: entry ${e} sem central header`);
    }
    const method = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const uncompressedSize = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);
    const nameBytes = bytes.subarray(ptr + 46, ptr + 46 + nameLen);
    const name = new TextDecoder("utf-8").decode(nameBytes);

    // Le local file header pra descobrir onde o data comeca
    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      throw new Error(`Zip invalido: local header em ${name}`);
    }
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);

    const entry: ZipEntry = {
      name,
      async arrayBuffer(): Promise<ArrayBuffer> {
        if (method === 0) {
          // stored
          const copy = new Uint8Array(uncompressedSize);
          copy.set(compressed);
          return copy.buffer;
        }
        if (method === 8) {
          // deflate raw
          const ds = new DecompressionStream("deflate-raw");
          const stream = new Blob([compressed]).stream().pipeThrough(ds);
          const decompressed = await new Response(stream).arrayBuffer();
          return decompressed;
        }
        throw new Error(
          `Zip metodo de compressao nao suportado: ${method} em ${name}`
        );
      },
      async text(): Promise<string> {
        const ab = await this.arrayBuffer();
        return new TextDecoder("utf-8").decode(ab);
      },
    };
    entries.push(entry);

    ptr += 46 + nameLen + extraLen + commentLen;
    if (ptr > cdOffset + cdSize) break;
  }
  return entries;
}

// ---- Casts especificos Groundswell ----

const profileCasts = {
  followers: casts.int,
  is_poi: casts.bool01,
  tracked_layer: casts.int,
  inferred_layer: casts.int,
  pagerank: casts.float,
  distinct_source_count: casts.int,
  pagerank_adjusted: casts.float,
  hits_authority: casts.float,
  influence_surplus: casts.float,
  followers_percentile: casts.float,
  pagerank_adjusted_percentile: casts.float,
  hits_authority_percentile: casts.float,
  authority_consensus_percentile: casts.float,
  influence_surplus_percentile: casts.float,
  isv: casts.float,
};

const bridgeCasts = {
  readiness_score: casts.float,
  profile_fit_score: casts.float,
  voice_quality_score: casts.float,
  proximity_score: casts.float,
  audience_score: casts.float,
  n_interactions: casts.int,
  n_comments: casts.int,
};

const relCasts = {
  source_is_poi: casts.bool01,
  target_is_poi: casts.bool01,
  n_interactions: casts.int,
  follower_asymmetry: casts.float,
  reciprocity: casts.bool01,
};

const intxCasts = {
  date_utc: casts.iso,
};

const sourceProfileCasts = {
  source_is_poi: casts.bool01,
  n_interactions: casts.int,
  n_authors: casts.int,
  n_authored_posts: casts.int,
  pct_endorsement: casts.float,
  pct_technical: casts.float,
  engaged_topic_distribution: casts.jsonSafe,
  authored_topic_distribution: casts.jsonSafe,
  intention_distribution: casts.jsonSafe,
  relation_type_distribution: casts.jsonSafe,
};

// ---- Mapping de coluna CSV -> field TS ----
// (a maioria e 1:1, listamos so os que diferem)

function mapBridge(row: Record<string, unknown>): GroundswellBridge {
  return {
    bridge_id: String(row.bridge_id),
    name: String(row.name ?? ""),
    headline: row.headline as string | undefined,
    current_company: row.current_company as string | undefined,
    context_fit: (row.context_fit as ContextFit) ?? undefined,
    readiness_score: row.readiness_score as number | undefined,
    readiness_tier: (row.readiness_tier as ReadinessTier) ?? undefined,
    profile_fit_score: row.profile_fit_score as number | undefined,
    voice_quality_score: row.voice_quality_score as number | undefined,
    proximity_score: row.proximity_score as number | undefined,
    audience_score: row.audience_score as number | undefined,
    rationale: row.rationale as string | undefined,
    n_interactions: row.n_interactions as number | undefined,
    n_comments: row.n_comments as number | undefined,
    analyzed_at: row.analyzed_at as string | undefined,
    model: row.model as string | undefined,
  };
}

function mapProfile(row: Record<string, unknown>): GroundswellProfile {
  return {
    profile_id: String(row.id),
    name: String(row.name ?? ""),
    node_type: row.node_type as string | undefined,
    public_identifier: row.public_identifier as string | undefined,
    linkedin_url: row.linkedin_url as string | undefined,
    headline: row.headline as string | undefined,
    current_company: row.current_company as string | undefined,
    current_position: row.current_position as string | undefined,
    followers: row.followers as number | undefined,
    is_poi: (row.is_poi as boolean) ?? false,
    tracked_layer: row.tracked_layer as number | undefined,
    inferred_layer: row.inferred_layer as number | undefined,
    pagerank: row.pagerank as number | undefined,
    distinct_source_count: row.distinct_source_count as number | undefined,
    pagerank_adjusted: row.pagerank_adjusted as number | undefined,
    hits_authority: row.hits_authority as number | undefined,
    influence_surplus: row.influence_surplus as number | undefined,
    followers_percentile: row.followers_percentile as number | undefined,
    pagerank_adjusted_percentile: row.pagerank_adjusted_percentile as number | undefined,
    hits_authority_percentile: row.hits_authority_percentile as number | undefined,
    authority_consensus_percentile: row.authority_consensus_percentile as number | undefined,
    influence_surplus_percentile: row.influence_surplus_percentile as number | undefined,
    isv: row.isv as number | undefined,
    computed_at: row.computed_at as string | undefined,
  };
}

function mapRelationship(row: Record<string, unknown>): GroundswellRelationship {
  return {
    source_id: String(row.source_id),
    source_name: row.source_name as string | undefined,
    source_is_poi: row.source_is_poi as boolean | undefined,
    target_id: String(row.target_id),
    target_name: row.target_name as string | undefined,
    target_is_poi: row.target_is_poi as boolean | undefined,
    relation_type: row.relation_type as string | undefined,
    relation_rationale: row.relation_rationale as string | undefined,
    n_interactions: row.n_interactions as number | undefined,
    follower_asymmetry: row.follower_asymmetry as number | undefined,
    reciprocity: row.reciprocity as boolean | undefined,
    dominant_intention: row.dominant_intention as string | undefined,
    top_topics: row.top_topics as string | undefined,
    analyzed_at: row.analyzed_at as string | undefined,
    model: row.model as string | undefined,
  };
}

function mapInteraction(row: Record<string, unknown>): GroundswellInteraction {
  return {
    source_id: String(row.source_id),
    source_name: row.source_name as string | undefined,
    target_id: row.target_id as string | undefined,
    target_name: row.target_name as string | undefined,
    ref_type: row.ref_type as GroundswellInteraction["ref_type"],
    post_id: row.post_id as string | undefined,
    post_url: row.post_url as string | undefined,
    post_content: row.post_content as string | undefined,
    commentary: row.commentary as string | undefined,
    topics: row.topics as string | undefined,
    intention: row.intention as string | undefined,
    language: row.language as string | undefined,
    date_utc: row.date_utc as string | undefined,
  };
}

function mapSourceProfile(row: Record<string, unknown>): GroundswellSourceProfile {
  return {
    source_id: String(row.source_id),
    source_name: row.source_name as string | undefined,
    source_is_poi: row.source_is_poi as boolean | undefined,
    n_interactions: row.n_interactions as number | undefined,
    n_authors: row.n_authors as number | undefined,
    n_authored_posts: row.n_authored_posts as number | undefined,
    pct_endorsement: row.pct_endorsement as number | undefined,
    pct_technical: row.pct_technical as number | undefined,
    engaged_topic_distribution: row.engaged_topic_distribution as Record<string, number> | undefined,
    authored_topic_distribution: row.authored_topic_distribution as Record<string, number> | undefined,
    intention_distribution: row.intention_distribution as Record<string, number> | undefined,
    relation_type_distribution: row.relation_type_distribution as Record<string, number> | undefined,
    languages: row.languages as string | undefined,
    computed_at: row.computed_at as string | undefined,
  };
}

// ---- Entrypoints ----

/** Recebe um File (zip) do input do usuario. */
export async function parseBundleZip(
  file: File,
  channel: Channel = "linkedin"
): Promise<GroundswellBundle> {
  const entries = await readZip(file);
  const filesText: Record<string, string> = {};
  for (const e of entries) {
    const isText =
      e.name.endsWith(".csv") ||
      e.name.endsWith(".txt") ||
      e.name.endsWith(".json") ||
      e.name.endsWith(".html");
    if (isText) filesText[e.name] = await e.text();
  }
  return buildBundle(filesText, channel);
}

// V5.3.1: assinaturas de schema pra classificar CSVs por conteudo.
// Cada tipo tem colunas OBRIGATORIAS unicas — se todas presentes, e do tipo.
// Ordem importa: mais especifico primeiro (evita ambiguidade).
type BundleTableType =
  | "bridges"
  | "profiles"
  | "relationships"
  | "interactions"
  | "source_profiles"
  | "brand_radar";

const SCHEMA_SIGNATURES: Array<{
  type: BundleTableType;
  requires: string[];
  /** Prioridade dentro do tipo — se 2 arquivos batem no mesmo tipo, o de maior
   *  prioridade vence (ex: interactions_full > interactions no layout antigo). */
  priorityHint?: (filename: string) => number;
}> = [
  {
    type: "bridges",
    requires: ["bridge_id", "readiness_score", "readiness_tier"],
  },
  {
    type: "profiles",
    requires: ["id", "is_poi", "pagerank"],
  },
  {
    type: "relationships",
    requires: ["source_id", "target_id", "relation_type", "reciprocity"],
  },
  {
    type: "interactions",
    requires: ["date_utc", "ref_type", "post_id"],
    // interactions_full (layout antigo) tem mais colunas — prefere.
    priorityHint: (name) => (name.includes("interactions_full") ? 1 : 0),
  },
  {
    type: "source_profiles",
    requires: ["source_id", "n_authored_posts"],
  },
  {
    type: "brand_radar",
    requires: ["metric", "value"],
  },
];

/** Extrai a primeira linha do CSV (header) sem depender do parseCsv completo. */
function readCsvHeader(raw: string): string[] {
  const firstLine = raw.split(/\r?\n/, 1)[0] ?? "";
  // Remove BOM se tiver
  const clean = firstLine.replace(/^﻿/, "").trim();
  if (!clean) return [];
  // CSV simples pro header — nao precisa lidar com quoted commas na primeira linha
  // (colunas raramente tem virgula literal no nome).
  return clean.split(",").map((c) => c.trim().toLowerCase());
}

/** Retorna o tipo do CSV baseado no header, ou null se nao bater com nenhum. */
function classifyCsv(header: string[]): BundleTableType | null {
  const set = new Set(header);
  for (const sig of SCHEMA_SIGNATURES) {
    const allPresent = sig.requires.every((col) => set.has(col.toLowerCase()));
    if (allPresent) return sig.type;
  }
  return null;
}

/** Manifest sintetico quando o zip nao tem advanced/manifest.json.
 *  Best-effort: extrai workspace + date do filename se possivel. */
function synthesizeManifest(
  filesText: Record<string, string>
): GroundswellManifest {
  // Tenta extrair de qualquer CSV: `<slug>/<NN>__<slug>__<YYYY-MM-DD>__*.csv`
  const anyCsv = Object.keys(filesText).find((k) => k.endsWith(".csv"));
  const m = anyCsv?.match(/(\d+)__([\w-]+)__(\d{4}-\d{2}-\d{2})__/);
  const slug = m?.[2] ?? "unknown-workspace";
  const date = m?.[3] ?? new Date().toISOString().slice(0, 10);
  return {
    workspace: slug,
    delivery_date: date,
    latest_engagement_date: date,
    generated_at: new Date().toISOString(),
    files: {},
  } as GroundswellManifest;
}

/** Constroi bundle a partir de um dict {filename: text} — util pra testes. */
export function buildBundle(
  filesText: Record<string, string>,
  channel: Channel = "linkedin"
): GroundswellBundle {
  // Manifest: prefere real; sintetiza se ausente (permite bundle sem manifest).
  const manifestKey = Object.keys(filesText).find((k) =>
    k.endsWith("manifest.json")
  );
  const manifest = manifestKey
    ? (JSON.parse(filesText[manifestKey]) as GroundswellManifest)
    : synthesizeManifest(filesText);

  // Classifica todos os CSVs (ignora `advanced/` — arquivos internos do exporter).
  const csvEntries = Object.entries(filesText).filter(
    ([name]) => name.endsWith(".csv") && !name.includes("/advanced/")
  );

  // Guarda o melhor candidato de cada tipo (com priority hint quando aplicavel).
  const classified: Partial<Record<BundleTableType, {
    filename: string;
    raw: string;
    priority: number;
  }>> = {};

  const unclassified: string[] = [];
  for (const [filename, raw] of csvEntries) {
    const header = readCsvHeader(raw);
    if (header.length === 0) continue;
    const type = classifyCsv(header);
    if (!type) {
      unclassified.push(filename);
      continue;
    }
    const sig = SCHEMA_SIGNATURES.find((s) => s.type === type);
    const priority = sig?.priorityHint?.(filename) ?? 0;
    const existing = classified[type];
    if (!existing || priority > existing.priority) {
      classified[type] = { filename, raw, priority };
    }
  }

  // V5.3.1 fallback pra retro-compat: se algum tipo essencial nao foi
  // classificado por schema (CSV custom, header mudou), tenta pelo sufixo
  // do filename como antes.
  const findByEndsWith = (suffix: string): string | undefined => {
    const key = Object.keys(filesText).find((k) => k.endsWith(suffix));
    return key ? filesText[key] : undefined;
  };
  const bridgesRaw =
    classified.bridges?.raw ?? findByEndsWith("bridges_ai_ranked.csv");
  const profilesRaw =
    classified.profiles?.raw ?? findByEndsWith("influence_ranking.csv");
  const relRaw =
    classified.relationships?.raw ?? findByEndsWith("relationships.csv");
  const intxRaw =
    classified.interactions?.raw ??
    findByEndsWith("interactions_full.csv") ??
    findByEndsWith("interactions.csv");
  const sourceProfilesRaw =
    classified.source_profiles?.raw ?? findByEndsWith("source_profiles.csv");
  const brandRadarRaw =
    classified.brand_radar?.raw ?? findByEndsWith("brand_radar.csv");

  // cohort_summary: unico .txt na raiz (nao em advanced/).
  const cohortKey = Object.keys(filesText).find(
    (k) => k.endsWith(".txt") && !k.includes("/advanced/")
  );
  const cohortRaw = cohortKey ? filesText[cohortKey] : undefined;

  // Log de identificacao — util pra debug quando bundle novo/exotico chega.
  if (unclassified.length > 0) {
    console.info(
      "[bundle-parser] CSVs nao classificados (ignorados):",
      unclassified.map((n) => n.split("/").pop())
    );
  }
  console.info("[bundle-parser] classificacao:", {
    bridges: classified.bridges?.filename ?? "fallback/ausente",
    profiles: classified.profiles?.filename ?? "fallback/ausente",
    relationships: classified.relationships?.filename ?? "fallback/ausente",
    interactions: classified.interactions?.filename ?? "fallback/ausente",
    source_profiles: classified.source_profiles?.filename ?? "fallback/ausente",
    brand_radar: classified.brand_radar?.filename ?? "fallback/ausente",
    cohort: cohortKey ?? "ausente",
  });

  const bundle: GroundswellBundle = {
    workspace_slug: manifest.workspace,
    delivery_date: manifest.delivery_date,
    latest_engagement_date: manifest.latest_engagement_date,
    channel,
    manifest,
    cohort_summary: cohortRaw,
    brand_radar: brandRadarRaw ? parseBrandRadar(brandRadarRaw) : undefined,
    profiles: profilesRaw
      ? parseCsv(profilesRaw, profileCasts).map(mapProfile)
      : [],
    bridges: bridgesRaw
      ? parseCsv(bridgesRaw, bridgeCasts).map(mapBridge)
      : [],
    relationships: relRaw
      ? parseCsv(relRaw, relCasts).map(mapRelationship)
      : [],
    interactions: intxRaw
      ? parseCsv(intxRaw, intxCasts).map(mapInteraction)
      : [],
    source_profiles: sourceProfilesRaw
      ? parseCsv(sourceProfilesRaw, sourceProfileCasts).map(mapSourceProfile)
      : [],
  };

  return bundle;
}

/** brand_radar.csv e um kv de 2 colunas (metric, value) */
function parseBrandRadar(raw: string): Record<string, number | string> {
  const rows = parseCsv<{ metric: string; value: string }>(raw);
  const out: Record<string, number | string> = {};
  for (const r of rows) {
    if (!r.metric) continue;
    const n = Number(r.value);
    out[r.metric] = Number.isFinite(n) ? n : r.value;
  }
  return out;
}

/** Sumariza contagens sem carregar rows inteiras. */
export function summarizeBundle(
  bundle: GroundswellBundle
): {
  n_profiles: number;
  n_pois: number;
  n_bridges: number;
  n_bridges_ready: number;
  n_relationships: number;
  n_interactions: number;
} {
  const n_pois = bundle.profiles.filter((p) => p.is_poi).length;
  const n_bridges_ready = bundle.bridges.filter(
    (b) => b.readiness_tier === "ready" && b.context_fit === "in_context"
  ).length;
  return {
    n_profiles: bundle.profiles.length,
    n_pois,
    n_bridges: bundle.bridges.length,
    n_bridges_ready,
    n_relationships: bundle.relationships.length,
    n_interactions: bundle.interactions.length,
  };
}
