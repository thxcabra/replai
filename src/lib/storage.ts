import { getSession } from "./auth";
import {
  deleteWorkspaceCloud,
  pullAll as cloudPullAll,
  pullReplied as cloudPullReplied,
  pushProfile,
  pushWorkspace,
  removeReplied,
  SyncError,
  upsertReplied,
} from "./sync";
import { isSupabaseConfigured, supabase } from "./supabase";
import type { Channel } from "./channels/types";
import type {
  ProfileRow,
  WorkspaceConfigJson,
  WorkspaceRow,
} from "./supabase-types";
import {
  DEFAULT_CONFIG,
  type Config,
  type SessionCache,
  type Workspace,
  type WorkspaceMeta,
} from "./types";

// Chaves do chrome.storage.local. Layout atual (V3 + V4 cache):
// - active_workspace_id: string
// - workspaces: { [id]: Workspace }
// - cache_<workspaceId>: SessionCache  (separado pra nao reescrever toda a
//     workspace dict em cada refresh)
// - graph_<workspaceId>: { data, meta }  (ver graph.ts)
// - profile_cache: ProfileRow | null  (V4: mirror local do profile do Supabase)
// - replied_<workspaceId>: string[]  (V3: ids planos; em V4 o source of truth
//     vira a tabela replied_tweets, esse cache continua pro fast-render)
//
// Layout legado (pre-fase-3 V3): config, last_results_cache, uploaded_graph
// como chaves top-level. A migracao roda no primeiro acesso.
const KEYS = {
  active: "active_workspace_id",
  workspaces: "workspaces",
  setupSeen: "setup_seen",
  profileCache: "profile_cache",
  activeChannel: "active_channel",
} as const;

const CACHE_PREFIX = "cache_";
const GRAPH_PREFIX = "graph_";
const REPLIED_PREFIX = "replied_";

const DEFAULT_WS_ID = "ws_default";

function newWorkspaceId(): string {
  // ws_ + 6 chars base36 (~36^6 = 2.1B, suficiente)
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  return `ws_${rand}`;
}

// ---- Cloud-aware helpers ----

// True quando Supabase ta configurado E ha sessao ativa. Toda mutation que
// chama esses helpers se comporta local-first; o push pro cloud sai depois
// (await ainda, mas erro nao bloqueia a UI - so loga).
async function isAuthed(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const session = await getSession();
    return Boolean(session?.user);
  } catch {
    return false;
  }
}

// Helper defensivo: extrai voice levando em conta o V3 legado (custom_prompt).
// Existe pra cobrir workspaces que foram criados pre-rename. Em qualquer
// lugar que precisamos da voz - tanto na hora de subir pro cloud quanto na
// hora de ler do cloud ou do local - usamos isso pra nao perder dado.
function pickVoice(
  ...sources: Array<Record<string, unknown> | undefined>
): string {
  for (const src of sources) {
    if (!src) continue;
    const v = src.voice;
    if (typeof v === "string" && v.trim()) return v;
    const legacy = src.custom_prompt;
    if (typeof legacy === "string" && legacy.trim()) return legacy;
  }
  return "";
}

// Tira keys do Config (V3 shape) pra deixar o que vai pro workspaces.config
// jsonb no Supabase (V4 schema). Keys vivem em profile (chaves nunca em jsonb).
// voice / voice_source SIM vao pro cloud (fundamental pra sincronizar entre
// devices - sem isso o analista perderia a voz ao trocar de device).
function configToCloudConfig(config: Config): WorkspaceConfigJson {
  return {
    listId: config.listId,
    llm_provider: config.llm_provider,
    timeWindowHours: config.timeWindowHours,
    includeUnmapped: config.includeUnmapped,
    model: config.model,
    langs: config.langs,
    maxBatch: config.maxBatch,
    maxPages: config.maxPages,
    dryRun: config.dryRun,
    voice: pickVoice(config as unknown as Record<string, unknown>),
    voice_source: config.voice_source ?? "",
    basePrompt: config.basePrompt ?? "",
    basePrompt_source: config.basePrompt_source ?? "",
    twitter_handle: (config.twitter_handle ?? "").trim().toLowerCase(),
    lists: config.lists,
    activeListId: config.activeListId,
    fetchAllLists: config.fetchAllLists,
    selectionFilter: config.selectionFilter,
    // V5.1: toggle canal X. Default true — omitido de workspaces antigos.
    twitter_enabled: config.twitter_enabled,
    // V5.0.4: campos LinkedIn — antes dropados no whitelist, causando
    // voz LinkedIn "salva" localmente mas voltando vazia no proximo pullAll.
    linkedin_enabled: config.linkedin_enabled,
    linkedin_voice: config.linkedin_voice,
    linkedin_daily_reply_limit: config.linkedin_daily_reply_limit,
    linkedin_daily_run_limit: config.linkedin_daily_run_limit,
    linkedin_bundle_id: config.linkedin_bundle_id,
    // V6: Persona X (publicos-alvo). Canal-especifica pos-V5.1.
    persona_public_target: config.persona_public_target,
    // V5.1: Persona LinkedIn (publicos-alvo). Canal-especifica.
    linkedin_persona_public_target: config.linkedin_persona_public_target,
    linkedin_time_window_hours: config.linkedin_time_window_hours,
    linkedin_max_batch: config.linkedin_max_batch,
  };
}

// Recompoe um Config a partir do row + profile. Keys vem do profile (single-
// set-of-keys por user). voice vem do cloud (com fallback pra legacy
// custom_prompt jsonb antigo); cai pro local se cloud nao tiver.
function cloudConfigToConfig(
  cloudConfig: WorkspaceConfigJson,
  profile: ProfileRow | null,
  existing?: Config
): Config {
  const base: Config = {
    ...DEFAULT_CONFIG,
    listId: cloudConfig.listId,
    llm_provider: cloudConfig.llm_provider,
    timeWindowHours: cloudConfig.timeWindowHours,
    includeUnmapped: cloudConfig.includeUnmapped,
    model: cloudConfig.model,
    langs: cloudConfig.langs,
    maxBatch: cloudConfig.maxBatch,
    maxPages: cloudConfig.maxPages ?? existing?.maxPages ?? DEFAULT_CONFIG.maxPages,
    dryRun: cloudConfig.dryRun,
    twitterapi_key: profile?.twitterapi_key ?? "",
    gemini_api_key: profile?.gemini_api_key ?? "",
    anthropic_api_key: profile?.anthropic_api_key ?? "",
    voice: pickVoice(
      cloudConfig as unknown as Record<string, unknown>,
      existing as unknown as Record<string, unknown> | undefined
    ),
    voice_source: cloudConfig.voice_source ?? existing?.voice_source ?? "",
    basePrompt: cloudConfig.basePrompt ?? existing?.basePrompt ?? "",
    basePrompt_source:
      cloudConfig.basePrompt_source ?? existing?.basePrompt_source ?? "",
    twitter_handle:
      cloudConfig.twitter_handle ?? existing?.twitter_handle ?? "",
    lists: cloudConfig.lists ?? existing?.lists,
    activeListId: cloudConfig.activeListId ?? existing?.activeListId,
    fetchAllLists:
      cloudConfig.fetchAllLists ?? existing?.fetchAllLists ?? false,
    selectionFilter:
      cloudConfig.selectionFilter ?? existing?.selectionFilter,
    // V5.0.4: hidrata LinkedIn com fallback pro existing local (mantem
    // edicoes in-flight nao sincronizadas ainda).
    linkedin_enabled:
      cloudConfig.linkedin_enabled ?? existing?.linkedin_enabled,
    linkedin_voice:
      cloudConfig.linkedin_voice ?? existing?.linkedin_voice,
    linkedin_daily_reply_limit:
      cloudConfig.linkedin_daily_reply_limit ??
      existing?.linkedin_daily_reply_limit,
    linkedin_daily_run_limit:
      cloudConfig.linkedin_daily_run_limit ??
      existing?.linkedin_daily_run_limit,
    linkedin_bundle_id:
      cloudConfig.linkedin_bundle_id ?? existing?.linkedin_bundle_id,
    twitter_enabled:
      cloudConfig.twitter_enabled ?? existing?.twitter_enabled,
    linkedin_persona_public_target:
      cloudConfig.linkedin_persona_public_target ??
      existing?.linkedin_persona_public_target,
    linkedin_time_window_hours:
      cloudConfig.linkedin_time_window_hours ??
      existing?.linkedin_time_window_hours,
    linkedin_max_batch:
      cloudConfig.linkedin_max_batch ?? existing?.linkedin_max_batch,
    persona_public_target:
      cloudConfig.persona_public_target ?? existing?.persona_public_target,
  };
  // V4.1 migration silenciosa: workspace antigo so tem listId. Cria
  // lists com uma entrada default pra UI multi-list funcionar.
  return ensureListsBackfill(base);
}

// Backfill V4.0 -> V4.1: workspace antigo so tem `listId` top-level.
// Cria `lists: [{ id, name: "Lista 1", listId }]` + activeListId
// pra dropdown e dependentes funcionarem. Roda silenciosamente.
function ensureListsBackfill(config: Config): Config {
  if (config.lists && config.lists.length > 0) {
    // Garante activeListId valido
    if (
      !config.activeListId ||
      !config.lists.find((l) => l.id === config.activeListId)
    ) {
      return { ...config, activeListId: config.lists[0].id };
    }
    return config;
  }
  if (!config.listId) return config;
  const listEntry = {
    id: `wsl_${Math.random().toString(36).slice(2, 10)}`,
    name: "Lista 1",
    listId: config.listId,
  };
  return {
    ...config,
    lists: [listEntry],
    activeListId: listEntry.id,
  };
}

function rowToWorkspace(
  row: WorkspaceRow,
  profile: ProfileRow | null,
  existing?: Workspace
): Workspace {
  return {
    id: row.id,
    name: row.name,
    createdAt: existing?.createdAt ?? new Date(row.created_at).getTime(),
    config: cloudConfigToConfig(row.config, profile, existing?.config),
  };
}

// Detecta keys novas no Config (ws) que devem ser pushadas pro profile.
// REGRA CRITICA: NUNCA pusha key vazia se o profile ja tem valor — isso evita
// que salvar workspace com config default (chaves vazias) APAGUE as chaves
// do profile. Pra "limpar" uma chave de verdade, o usuario precisa explicitamente
// usar a UI de Settings (form com value="" salvo explicitamente).
function profileDeltaFromConfig(
  config: Config,
  profile: ProfileRow | null
): Partial<Pick<
  ProfileRow,
  "twitterapi_key" | "gemini_api_key" | "anthropic_api_key"
>> | null {
  const delta: Partial<Pick<
    ProfileRow,
    "twitterapi_key" | "gemini_api_key" | "anthropic_api_key"
  >> = {};
  // So pusha se config tem valor nao-vazio AND difere do profile. Vazio = no-op.
  if (
    config.twitterapi_key &&
    config.twitterapi_key !== (profile?.twitterapi_key ?? "")
  ) {
    delta.twitterapi_key = config.twitterapi_key;
  }
  if (
    config.gemini_api_key &&
    config.gemini_api_key !== (profile?.gemini_api_key ?? "")
  ) {
    delta.gemini_api_key = config.gemini_api_key;
  }
  if (
    config.anthropic_api_key &&
    config.anthropic_api_key !== (profile?.anthropic_api_key ?? "")
  ) {
    delta.anthropic_api_key = config.anthropic_api_key;
  }
  return Object.keys(delta).length > 0 ? delta : null;
}

// Fire-and-forget log de erro - cloud push nao deve bloquear UI nem virar throw.
// Mas notifica listeners (App.tsx) pra surfar a falha num banner visivel.
type SyncErrorListener = (op: string, err: Error) => void;
const syncErrorListeners = new Set<SyncErrorListener>();

export function onSyncError(cb: SyncErrorListener): () => void {
  syncErrorListeners.add(cb);
  return () => {
    syncErrorListeners.delete(cb);
  };
}

// V4.1.14 (WR-07): API publica pra outros modulos (intelligence.ts,
// posts-suggestion.ts) surfarem erros pelo mesmo canal usado por sync cloud.
// Antes a falha de get_author_profiles ou enrichWithIntelligence era so
// console.warn — invisivel pro analista. Agora chama o banner vermelho.
export function notifySyncError(op: string, e: unknown): void {
  const err = e instanceof Error ? e : new Error(String(e));
  for (const cb of syncErrorListeners) {
    try {
      cb(op, err);
    } catch {
      /* ignore listener errors */
    }
  }
}

function logCloudError(op: string, e: unknown): void {
  const err = e instanceof Error ? e : new Error(String(e));
  // Reescreve a mensagem se for RLS — ajuda o analista entender que e auth,
  // nao falha de rede. Sem isso, mensagens cripticas tipo "USING expression"
  // confundem usuarios finais.
  if (e instanceof SyncError && e.isRlsError) {
    const friendly = new Error(
      `permissao negada pelo Supabase. Tente sair e logar de novo. ` +
        `Se persistir, avise o admin com o erro: ${err.message}`
    );
    friendly.name = "RlsError";
    console.warn(`[storage] cloud ${op} bloqueado por RLS:`, err);
    for (const cb of syncErrorListeners) {
      try {
        cb(op, friendly);
      } catch {
        /* ignore listener errors */
      }
    }
    return;
  }
  console.warn(`[storage] cloud ${op} falhou (mantendo local):`, err);
  for (const cb of syncErrorListeners) {
    try {
      cb(op, err);
    } catch {
      /* ignore listener errors */
    }
  }
}

// V4.1.14 (IN-07): logs verbose so com flag REPLAI_DEBUG no chrome.storage.
// Antes, [storage] cloud ... ficava logando voice_len, twitter_handle, etc
// em todos os usuarios (devtools acumula PII em terminal compartilhado).
let debugCloudLogs: boolean | null = null;
async function isDebugEnabled(): Promise<boolean> {
  if (debugCloudLogs !== null) return debugCloudLogs;
  try {
    const r = await chrome.storage.local.get("REPLAI_DEBUG");
    debugCloudLogs = Boolean(r.REPLAI_DEBUG);
  } catch {
    debugCloudLogs = false;
  }
  return debugCloudLogs;
}

function logCloudInfo(op: string, detail?: unknown): void {
  isDebugEnabled().then((on) => {
    if (on) console.info(`[storage] cloud ${op}`, detail ?? "");
  });
}

// Migracao V2->V3 (pre-fase-3). Mantida intacta porque ainda ha usuarios com
// chrome.storage de V2 (config top-level). NAO confundir com migracao V3->V4
// (essa fica em src/lib/migration.ts no M5).
//
// V4.1.15: tambem renomeia QUALQUER workspace local com id "ws_default" pra
// ID unico. Esse literal era compartilhado entre usuarios, causando colisao
// de PK no upsert do Supabase ("violates RLS USING expression"). Cada user
// agora tem ID proprio gerado por newWorkspaceId().
let migrationPromise: Promise<void> | null = null;
async function migrateIfNeeded(): Promise<void> {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    const stored = await chrome.storage.local.get([
      KEYS.active,
      KEYS.workspaces,
      "config",
      "last_results_cache",
      "uploaded_graph",
    ]);

    // V4.1.15: renomeia ws_default local se existir (independente de migration V2)
    await migrateLegacyDefaultId();

    if (stored[KEYS.active]) return; // ja migrou V2->V3

    const legacyConfig = stored.config as Partial<Config> | undefined;
    const freshId = newWorkspaceId();
    const ws: Workspace = {
      id: freshId,
      name: "Default",
      createdAt: Date.now(),
      config: { ...DEFAULT_CONFIG, ...(legacyConfig ?? {}) },
    };

    const writes: Record<string, unknown> = {
      [KEYS.active]: ws.id,
      [KEYS.workspaces]: { [ws.id]: ws },
    };
    if (stored.last_results_cache) {
      writes[`${CACHE_PREFIX}${ws.id}`] = stored.last_results_cache;
    }
    if (stored.uploaded_graph) {
      writes[`${GRAPH_PREFIX}${ws.id}`] = stored.uploaded_graph;
    }

    await chrome.storage.local.set(writes);
    await chrome.storage.local.remove([
      "config",
      "last_results_cache",
      "uploaded_graph",
    ]);
  })();
  return migrationPromise;
}

// V4.1.15: usuarios pre-V4.1.15 podem ter workspace local com id "ws_default"
// (criado em fallbacks de getActiveWorkspace, deleteWorkspace, ou migration V2).
// Renomeia pra um ID unico ANTES de qualquer push pro Supabase pra evitar
// colisao com rows de outros analistas (que podem ter pushado primeiro).
async function migrateLegacyDefaultId(): Promise<void> {
  const stored = await chrome.storage.local.get([
    KEYS.workspaces,
    KEYS.active,
  ]);
  const workspaces =
    (stored[KEYS.workspaces] as Record<string, Workspace>) ?? {};
  if (!workspaces[DEFAULT_WS_ID]) return; // nao tem nada pra migrar

  const oldWs = workspaces[DEFAULT_WS_ID];
  const newId = newWorkspaceId();
  const renamed: Workspace = { ...oldWs, id: newId };
  delete workspaces[DEFAULT_WS_ID];
  workspaces[newId] = renamed;

  const writes: Record<string, unknown> = { [KEYS.workspaces]: workspaces };
  if (stored[KEYS.active] === DEFAULT_WS_ID) writes[KEYS.active] = newId;

  // Move caches/replied/graph que apontam pro id antigo
  const ALL_PREFIXES = [CACHE_PREFIX, GRAPH_PREFIX, REPLIED_PREFIX];
  const keysToMove = ALL_PREFIXES.map((p) => `${p}${DEFAULT_WS_ID}`);
  const movedStored = await chrome.storage.local.get(keysToMove);
  const toRemove: string[] = [];
  for (const oldKey of keysToMove) {
    if (movedStored[oldKey] !== undefined) {
      const prefix = oldKey.slice(0, -DEFAULT_WS_ID.length);
      writes[`${prefix}${newId}`] = movedStored[oldKey];
      toRemove.push(oldKey);
    }
  }

  await chrome.storage.local.set(writes);
  if (toRemove.length > 0) await chrome.storage.local.remove(toRemove);
  console.info(
    `[storage] V4.1.15: renamed legacy ws_default to ${newId} (locally)`
  );
}

// ---- Workspaces ----

export async function getActiveWorkspaceId(): Promise<string> {
  await migrateIfNeeded();
  const stored = await chrome.storage.local.get(KEYS.active);
  return (stored[KEYS.active] as string) ?? DEFAULT_WS_ID;
}

export async function setActiveWorkspaceId(id: string): Promise<void> {
  await chrome.storage.local.set({ [KEYS.active]: id });
  if (await isAuthed()) {
    try {
      await pushProfile({ active_workspace_id: id });
    } catch (e) {
      logCloudError("setActiveWorkspaceId", e);
    }
  }
}

// V5.1: canal ativo persistido em chrome.storage.local. Sobrevive reloads
// e trocas de workspace. Nao sincroniza pra cloud — e preferencia UI local.
export async function getActiveChannel(): Promise<Channel> {
  const stored = await chrome.storage.local.get(KEYS.activeChannel);
  const v = stored[KEYS.activeChannel] as string | undefined;
  return v === "linkedin" ? "linkedin" : "twitter";
}

export async function setActiveChannel(c: Channel): Promise<void> {
  await chrome.storage.local.set({ [KEYS.activeChannel]: c });
}

export async function listWorkspaces(): Promise<WorkspaceMeta[]> {
  await migrateIfNeeded();
  const stored = await chrome.storage.local.get(KEYS.workspaces);
  const workspaces =
    (stored[KEYS.workspaces] as Record<string, Workspace>) ?? {};
  return Object.values(workspaces)
    .map((ws) => ({ id: ws.id, name: ws.name, createdAt: ws.createdAt }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  await migrateIfNeeded();
  const stored = await chrome.storage.local.get(KEYS.workspaces);
  const workspaces =
    (stored[KEYS.workspaces] as Record<string, Workspace>) ?? {};
  const ws = workspaces[id];
  if (!ws) return null;
  // Normaliza voz legacy (custom_prompt -> voice) em workspaces antigos.
  // Garante que LLM sempre receba a voz mesmo se o jsonb veio do V3.
  const v = pickVoice(ws.config as unknown as Record<string, unknown>);
  if (v && !ws.config.voice) {
    ws.config = { ...ws.config, voice: v };
  }
  // V4.1: backfill `lists` a partir do listId legado se nao houver.
  ws.config = ensureListsBackfill(ws.config);
  return ws;
}

// Garante workspace ativo valido. Ordem de fallback:
//   1. active_workspace_id atual aponta pra workspace existente -> usa
//   2. Tem outros workspaces salvos -> usa o mais recente (createdAt desc)
//   3. Nao tem nenhum -> cria Default com keys hidratadas do profile
//
// Critico: NAO cria Default novo se o user ja tem workspaces. Evita o
// cenario "logout/login fez perder Teste e mostrou Default".
export async function getActiveWorkspace(): Promise<Workspace> {
  const id = await getActiveWorkspaceId();
  const ws = await getWorkspace(id);
  if (ws) return ws;

  // active aponta pra nada. Tenta primeiro workspace existente (mais recente).
  const stored = await chrome.storage.local.get(KEYS.workspaces);
  const workspaces =
    (stored[KEYS.workspaces] as Record<string, Workspace>) ?? {};
  const list = Object.values(workspaces).sort(
    (a, b) => b.createdAt - a.createdAt
  );
  if (list.length > 0) {
    await setActiveWorkspaceId(list[0].id);
    return list[0];
  }

  // Truly empty -> cria Default com keys hidratadas (so executa pra user fresh).
  const profile = await getProfileCache();
  const config: Config = {
    ...DEFAULT_CONFIG,
    twitterapi_key: profile?.twitterapi_key ?? "",
    gemini_api_key: profile?.gemini_api_key ?? "",
    anthropic_api_key: profile?.anthropic_api_key ?? "",
  };
  // V4.1.15: id unico por user — ws_default era literal compartilhado e
  // batia em RLS USING quando dois analistas faziam upsert no mesmo PK.
  const fallback: Workspace = {
    id: newWorkspaceId(),
    name: "Default",
    createdAt: Date.now(),
    config,
  };
  await saveWorkspace(fallback);
  await setActiveWorkspaceId(fallback.id);
  return fallback;
}

// Write local-first, depois push pro cloud se autenticado. Profile keys
// sincroniza se mudaram (single-set-of-keys policy).
export async function saveWorkspace(ws: Workspace): Promise<void> {
  // V4.1.14 (WR-02): marca in-flight ANTES do write local. Antes ficava
  // entre o write e o push, deixando uma janela onde pullAll podia ver o
  // local e nao saber que ha um push em andamento, mergiando estado cloud
  // stale sobre o local recem escrito.
  const authedNow = await isAuthed();
  if (authedNow) inFlightPushes.add(ws.id);

  const stored = await chrome.storage.local.get(KEYS.workspaces);
  const workspaces =
    (stored[KEYS.workspaces] as Record<string, Workspace>) ?? {};
  workspaces[ws.id] = ws;
  await chrome.storage.local.set({ [KEYS.workspaces]: workspaces });

  if (!authedNow) return;
  try {
    const profile = await getProfileCache();
    const delta = profileDeltaFromConfig(ws.config, profile);
    if (delta) {
      const updated = await pushProfile(delta);
      await chrome.storage.local.set({ [KEYS.profileCache]: updated });
    }
    const cloudConfig = configToCloudConfig(ws.config);
    logCloudInfo(`pushWorkspace start id=${ws.id} name=${ws.name}`, {
      voice_len: cloudConfig.voice?.length ?? 0,
      twitter_handle: cloudConfig.twitter_handle,
    });
    const pushed = await pushWorkspace({
      id: ws.id,
      name: ws.name,
      config: cloudConfig,
    });
    logCloudInfo(`pushWorkspace OK id=${pushed.id}`);
    // Versiona a voz no Supabase pra A/B test futuro. Idempotente.
    const voice = pickVoice(ws.config as unknown as Record<string, unknown>);
    if (voice) {
      const { saveVoiceVersion } = await import("./voice-versions");
      saveVoiceVersion(ws.id, voice, ws.config.voice_source ?? "paste").catch(
        (e) => console.warn("[storage] saveVoiceVersion:", e)
      );
    }
  } catch (e) {
    logCloudError("saveWorkspace", e);
  } finally {
    inFlightPushes.delete(ws.id);
  }
}

export async function createWorkspace(
  name: string,
  copyFromId?: string
): Promise<Workspace> {
  await migrateIfNeeded();
  const id = newWorkspaceId();
  let config: Config = { ...DEFAULT_CONFIG };

  if (copyFromId) {
    const source = await getWorkspace(copyFromId);
    if (source) config = { ...source.config };
  } else {
    // hidrata chaves do profile pra workspace novo funcionar de imediato
    // (sem precisar esperar pullAll trazer profile -> config). Tambem evita
    // que profileDeltaFromConfig veja delta vazio e a UI mostre "sem chave".
    const profile = await getProfileCache();
    config = {
      ...config,
      twitterapi_key: profile?.twitterapi_key ?? config.twitterapi_key,
      gemini_api_key: profile?.gemini_api_key ?? config.gemini_api_key,
      anthropic_api_key:
        profile?.anthropic_api_key ?? config.anthropic_api_key,
    };
  }

  const ws: Workspace = {
    id,
    name: name.trim() || "novo workspace",
    createdAt: Date.now(),
    config,
  };
  await saveWorkspace(ws);

  // Se duplicou, copia tambem o grafo uploaded (mas nao o cache da sessao).
  // Grafo continua local-only por design (ver plano V4).
  if (copyFromId) {
    const graphKey = `${GRAPH_PREFIX}${copyFromId}`;
    const stored = await chrome.storage.local.get(graphKey);
    const graph = stored[graphKey];
    if (graph) {
      await chrome.storage.local.set({ [`${GRAPH_PREFIX}${id}`]: graph });
    }
  }

  return ws;
}

export async function renameWorkspace(
  id: string,
  newName: string
): Promise<void> {
  const ws = await getWorkspace(id);
  if (!ws) return;
  ws.name = newName.trim() || ws.name;
  await saveWorkspace(ws);
}

// Apaga o workspace e tudo associado (cache + grafo). Se for o ultimo,
// cria um Default fresco no lugar. Retorna o novo activeId.
export async function deleteWorkspace(id: string): Promise<string> {
  const stored = await chrome.storage.local.get([
    KEYS.workspaces,
    KEYS.active,
  ]);
  const workspaces =
    (stored[KEYS.workspaces] as Record<string, Workspace>) ?? {};
  const activeId = stored[KEYS.active] as string;

  if (!workspaces[id]) {
    throw new Error(`Workspace ${id} nao existe.`);
  }

  delete workspaces[id];
  await chrome.storage.local.remove([
    `${CACHE_PREFIX}${id}`,
    `${GRAPH_PREFIX}${id}`,
    `${REPLIED_PREFIX}${id}`,
  ]);

  let newActiveId = activeId;
  if (Object.keys(workspaces).length === 0) {
    // ultimo workspace apagado: cria um Default novo
    // V4.1.15: id unico por user — ws_default era literal compartilhado
    const fresh: Workspace = {
      id: newWorkspaceId(),
      name: "Default",
      createdAt: Date.now(),
      config: { ...DEFAULT_CONFIG },
    };
    workspaces[fresh.id] = fresh;
    newActiveId = fresh.id;
  } else if (activeId === id) {
    // ativo foi apagado: seleciona o primeiro restante (mais antigo)
    const remaining = Object.values(workspaces).sort(
      (a, b) => a.createdAt - b.createdAt
    );
    newActiveId = remaining[0].id;
  }

  await chrome.storage.local.set({
    [KEYS.workspaces]: workspaces,
    [KEYS.active]: newActiveId,
  });

  if (await isAuthed()) {
    try {
      await deleteWorkspaceCloud(id);
      if (newActiveId !== activeId) {
        const updated = await pushProfile({ active_workspace_id: newActiveId });
        await chrome.storage.local.set({ [KEYS.profileCache]: updated });
      }
    } catch (e) {
      logCloudError("deleteWorkspace", e);
    }
  }

  return newActiveId;
}

// ---- Validacao de config ----
// Mantido como funcao pura pra UI checar antes de "atualizar".
export function isConfigComplete(config: Config): boolean {
  // V4.1.16: aceita top-level listId (legacy) OU multi-list lists[] preenchido.
  // Antes so olhava listId top-level — workspaces criados pos-V4.1 que
  // usavam o bloco multi-list sem marcar a lista como ativa caiam em
  // "config incompleta" mesmo com a lista preenchida.
  if (config.listId?.trim()) return true;
  if (Array.isArray(config.lists)) {
    const anyFilled = config.lists.some((l) => l.listId?.trim());
    if (anyFilled) return true;
  }
  return false;
}

// ---- Setup inicial ----
// Flag local-only que indica que o analista ja viu a tela de configuracoes
// pelo menos uma vez. V4 tem campo equivalente em profile.setup_complete que
// o SetupWizard checa; esse permanece pro fallback nao-logado.
export async function getSetupSeen(): Promise<boolean> {
  const stored = await chrome.storage.local.get(KEYS.setupSeen);
  return stored[KEYS.setupSeen] === true;
}

export async function markSetupSeen(): Promise<void> {
  await chrome.storage.local.set({ [KEYS.setupSeen]: true });
  if (await isAuthed()) {
    try {
      const updated = await pushProfile({ setup_complete: true });
      await chrome.storage.local.set({ [KEYS.profileCache]: updated });
    } catch (e) {
      logCloudError("markSetupSeen", e);
    }
  }
}

// ---- Cache de sessao (per-workspace, local-only) ----
// SessionCache nao sincroniza: e per-device por design (cada device pode estar
// numa janela de tempo diferente, com cache fresco ou stale).

export async function getSessionCache(
  workspaceId: string
): Promise<SessionCache | null> {
  const key = `${CACHE_PREFIX}${workspaceId}`;
  const stored = await chrome.storage.local.get(key);
  return (stored[key] as SessionCache) ?? null;
}

export async function saveSessionCache(
  workspaceId: string,
  cache: SessionCache
): Promise<void> {
  await chrome.storage.local.set({ [`${CACHE_PREFIX}${workspaceId}`]: cache });
}

export async function clearSessionCache(workspaceId: string): Promise<void> {
  await chrome.storage.local.remove(`${CACHE_PREFIX}${workspaceId}`);
}

// ---- Export / Import de workspace como JSON ----

export interface ExportedWorkspace {
  version: 1;
  name: string;
  exportedAt: number;
  config: Config;
  graph?: { data: unknown; meta: unknown };
}

// Exporta um workspace como JSON. SEMPRE filtra chaves antes de devolver
// (segurança V4: chaves nunca em export JSON, plano explicito).
// Cache de sessao e replied-ids NAO sao exportados.
export async function exportWorkspace(id: string): Promise<ExportedWorkspace> {
  const ws = await getWorkspace(id);
  if (!ws) throw new Error("Workspace nao existe.");
  const graphKey = `${GRAPH_PREFIX}${id}`;
  const stored = await chrome.storage.local.get(graphKey);
  const graph = stored[graphKey] as
    | { data: unknown; meta: unknown }
    | undefined;
  // SCRUB: chaves zeradas antes do export.
  const safeConfig: Config = {
    ...ws.config,
    twitterapi_key: "",
    gemini_api_key: "",
    anthropic_api_key: "",
  };
  return {
    version: 1,
    name: ws.name,
    exportedAt: Date.now(),
    config: safeConfig,
    ...(graph ? { graph } : {}),
  };
}

// Cria um workspace novo a partir do payload de export. Faz backfill com
// DEFAULT_CONFIG pra cobrir versoes mais antigas do schema.
export async function importWorkspace(payload: unknown): Promise<Workspace> {
  if (!payload || typeof payload !== "object") {
    throw new Error("Arquivo nao e um JSON valido.");
  }
  const p = payload as Partial<ExportedWorkspace>;
  if (!p.name || !p.config || typeof p.config !== "object") {
    throw new Error(
      "Arquivo nao parece ser um workspace exportado do Replai (faltando name ou config)."
    );
  }

  const id = newWorkspaceId();
  const ws: Workspace = {
    id,
    name: p.name,
    createdAt: Date.now(),
    config: { ...DEFAULT_CONFIG, ...p.config },
  };
  await saveWorkspace(ws);

  if (p.graph) {
    await chrome.storage.local.set({ [`${GRAPH_PREFIX}${id}`]: p.graph });
  }

  return ws;
}

// ---- Tweets marcados como respondidos (por workspace) ----
// Cache local de tweet_ids respondidos. V4: source of truth e tabela
// replied_tweets no Supabase, esse array continua pro fast-render (lista grande,
// nao queremos query cada render).

export async function getRepliedIds(workspaceId: string): Promise<string[]> {
  const key = `${REPLIED_PREFIX}${workspaceId}`;
  const stored = await chrome.storage.local.get(key);
  return (stored[key] as string[]) ?? [];
}

export async function setReplied(
  workspaceId: string,
  tweetId: string,
  replied: boolean,
  meta?: {
    tweet_author?: string;
    tweet_text?: string;
    reply_text?: string;
    reply_category?: string;
    reply_index?: number;
    was_edited?: boolean;
    posted_confirmed?: boolean;
  }
): Promise<string[]> {
  const ids = await getRepliedIds(workspaceId);
  const set = new Set(ids);
  if (replied) set.add(tweetId);
  else set.delete(tweetId);
  const next = [...set];
  await chrome.storage.local.set({
    [`${REPLIED_PREFIX}${workspaceId}`]: next,
  });

  if (await isAuthed()) {
    try {
      if (replied) {
        await upsertReplied({
          workspace_id: workspaceId,
          tweet_id: tweetId,
          ...(meta ?? {}),
        });
      } else {
        await removeReplied(workspaceId, tweetId);
      }
    } catch (e) {
      logCloudError("setReplied", e);
    }
  }
  return next;
}

// ---- Profile cache (V4) ----
// Mirror local de profiles do Supabase. UI le sempre daqui; mutations vao via
// updateProfile() que faz dual-write. Quando nao-logado, profile e null.

// V5.3 hardening: chaves de API sensiveis NUNCA vao pro chrome.storage.local.
// - `profile_cache` no disco contem tudo menos as chaves (redacted).
// - `profileKeysMem` guarda as chaves em MEMORIA do service worker (nunca no
//   disco, nunca no OneDrive backup do Windows). Se o worker morrer, o proximo
//   fetch re-hidrata via Supabase (RLS garante que so o proprio user le).
// Vetor eliminado: acesso ao arquivo local do storage do extension.
const API_KEY_FIELDS: Array<keyof ProfileRow> = [
  "twitterapi_key",
  "gemini_api_key",
  "anthropic_api_key",
  "notion_api_token",
  "apify_api_key",
];

let profileKeysMem: Partial<Pick<
  ProfileRow,
  "twitterapi_key" | "gemini_api_key" | "anthropic_api_key" | "notion_api_token" | "apify_api_key"
>> = {};

function redactKeys(profile: ProfileRow): ProfileRow {
  const clone: ProfileRow = { ...profile };
  for (const k of API_KEY_FIELDS) {
    // ts nao entende assign polimorfico aqui, cast local intencional
    (clone as unknown as Record<string, unknown>)[k] = null;
  }
  return clone;
}

function extractKeys(profile: ProfileRow) {
  return {
    twitterapi_key: profile.twitterapi_key,
    gemini_api_key: profile.gemini_api_key,
    anthropic_api_key: profile.anthropic_api_key,
    notion_api_token: profile.notion_api_token,
    apify_api_key: profile.apify_api_key,
  };
}

/**
 * Retorna o profile cache local + rehidrata as chaves em memoria.
 * As chaves NAO vem do disco (foram redacted em setProfileCache); elas vem
 * de `profileKeysMem` OU de um fetch direto ao Supabase se a memoria zerou
 * (ex: service worker MV3 hibernou). RLS garante que so o proprio user le.
 */
export async function getProfileCache(): Promise<ProfileRow | null> {
  const stored = await chrome.storage.local.get(KEYS.profileCache);
  const cached = (stored[KEYS.profileCache] as ProfileRow | null) ?? null;
  if (!cached) return null;
  // Se a memoria zerou (service worker morreu) mas temos cache local com
  // profile id, re-hidrata as chaves silenciosamente. Uma unica chamada
  // por sessao pro Supabase — RLS filtra so o proprio profile.
  if (!profileKeysMem.gemini_api_key && !profileKeysMem.anthropic_api_key && cached.id) {
    try {
      const authed = await isAuthed();
      if (authed) {
        const { data } = await supabase
          .from("profiles")
          .select(
            "twitterapi_key, gemini_api_key, anthropic_api_key, notion_api_token, apify_api_key"
          )
          .eq("id", cached.id)
          .maybeSingle();
        if (data) {
          profileKeysMem = {
            twitterapi_key: (data as ProfileRow).twitterapi_key,
            gemini_api_key: (data as ProfileRow).gemini_api_key,
            anthropic_api_key: (data as ProfileRow).anthropic_api_key,
            notion_api_token: (data as ProfileRow).notion_api_token,
            apify_api_key: (data as ProfileRow).apify_api_key,
          };
        }
      }
    } catch (e) {
      logCloudError("getProfileCache rehydrate keys", e);
    }
  }
  return { ...cached, ...profileKeysMem };
}

async function setProfileCache(profile: ProfileRow | null): Promise<void> {
  if (profile) {
    // Guarda chaves em memoria; grava no disco a versao redacted.
    profileKeysMem = extractKeys(profile);
    await chrome.storage.local.set({ [KEYS.profileCache]: redactKeys(profile) });
  } else {
    profileKeysMem = {};
    await chrome.storage.local.remove(KEYS.profileCache);
  }
}

export async function updateProfile(
  updates: Partial<Omit<ProfileRow, "id" | "created_at" | "updated_at">>
): Promise<ProfileRow | null> {
  if (!(await isAuthed())) return null;
  try {
    const updated = await pushProfile(updates);
    await setProfileCache(updated);
    return updated;
  } catch (e) {
    logCloudError("updateProfile", e);
    return null;
  }
}

// ---- Pull-all (background polling + post-login) ----
// Refresh do cache local com cloud state. Sobrescreve workspaces + profile
// no chrome.storage. Mantem caches de sessao/grafo/replied locais intactos
// (esses sao per-device ou puxados sob demanda).

// In-flight push tracker. pullAll() pula workspaces que estao sendo pushados
// pro cloud agora (rename/create/saveConfig), evitando race que sobrescrevia
// local com cloud stale antes do push completar.
const inFlightPushes = new Set<string>();

export async function pullAll(): Promise<void> {
  if (!(await isAuthed())) {
    logCloudInfo("pullAll skipped (no session)");
    return;
  }
  try {
    const state = await cloudPullAll();
    logCloudInfo("pullAll fetched", {
      profile_email: state.profile?.email,
      profile_has_gemini: Boolean(state.profile?.gemini_api_key),
      profile_has_anthropic: Boolean(state.profile?.anthropic_api_key),
      workspaces_count: state.workspaces.length,
      workspace_names: state.workspaces.map((w) => w.name),
    });
    await setProfileCache(state.profile);

    const localStored = await chrome.storage.local.get(KEYS.workspaces);
    const localMap =
      (localStored[KEYS.workspaces] as Record<string, Workspace>) ?? {};

    // Filtra workspaces pro local cache: SOMENTE os do user atual.
    // Admin ve workspaces de outros via RLS, mas nao queremos eles no dropdown
    // de workspaces da UI normal — admin acessa dados dos outros via AdminPanel.
    const ownWorkspaces = state.profile?.id
      ? state.workspaces.filter((w) => w.user_id === state.profile?.id)
      : state.workspaces;

    // Merge nao-destrutivo: comeca do local pra preservar workspaces que ainda
    // nao chegaram no cloud (push em voo, push falhou, criados offline).
    // Tambem PULA workspaces com push em voo — esses ja tem state mais fresco
    // local que o cloud retornou.
    const merged: Record<string, Workspace> = { ...localMap };
    for (const row of ownWorkspaces) {
      if (inFlightPushes.has(row.id)) {
        logCloudInfo("pullAll skip merge (in-flight push)", { id: row.id });
        continue;
      }
      merged[row.id] = rowToWorkspace(row, state.profile, localMap[row.id]);
    }
    // Limpa local-only workspaces que NAO sao do user atual (defesa contra
    // contas trocadas no mesmo device). Mantem os do user mesmo se nao
    // estiverem no cloud ainda.
    if (state.profile?.id) {
      const cloudIds = new Set(ownWorkspaces.map((w) => w.id));
      for (const id of Object.keys(merged)) {
        const local = merged[id];
        // se nao esta no cloud E nao tem push em voo => provavelmente lixo
        // de conta anterior, remove. Mas preserva se estiver em flight.
        if (!cloudIds.has(id) && !inFlightPushes.has(id)) {
          // verifica se e um workspace recem-criado local (createdAt recente)
          // — se sim, preserva (provavelmente push ainda nao rodou).
          const RECENT_WINDOW_MS = 60_000;
          if (Date.now() - local.createdAt > RECENT_WINDOW_MS) {
            delete merged[id];
          }
        }
      }
    }
    await chrome.storage.local.set({ [KEYS.workspaces]: merged });

    // active_workspace_id: regra simples:
    //   1. profile aponta pra workspace existente -> usa
    //   2. local ja tem um active valido -> mantem (NAO sobrescreve!)
    //   3. ultimo recurso -> ultimo usado por updated_at
    // Reduz aggressividade do fallback que sobrescrevia active correto
    // em races (analista trocava de workspace, pullAll rodava, fallback
    // escolhia outro workspace por updated_at).
    let activeId: string | null = null;
    if (
      state.profile?.active_workspace_id &&
      merged[state.profile.active_workspace_id]
    ) {
      activeId = state.profile.active_workspace_id;
    } else {
      // Tenta preservar o active local antes de fallback
      const localActive = await chrome.storage.local.get(KEYS.active);
      const localActiveId = localActive[KEYS.active] as string | undefined;
      if (localActiveId && merged[localActiveId]) {
        activeId = localActiveId;
      } else if (ownWorkspaces.length > 0) {
        const sorted = [...ownWorkspaces].sort((a, b) => {
          const ta = new Date(a.updated_at).getTime();
          const tb = new Date(b.updated_at).getTime();
          return tb - ta;
        });
        activeId = sorted[0].id;
        logCloudInfo("pullAll active fallback (most recent)", { activeId });
      }
    }
    if (activeId) {
      await chrome.storage.local.set({ [KEYS.active]: activeId });
    }
    logCloudInfo("pullAll OK", {
      synced_workspaces: Object.keys(merged).length,
      active: activeId,
    });
  } catch (e) {
    logCloudError("pullAll", e);
  }
}

// Refresh somente do replied list de um workspace especifico. Util quando
// abre o workspace ou volta foco na tab.
export async function pullRepliedForWorkspace(
  workspaceId: string
): Promise<void> {
  if (!(await isAuthed())) return;
  try {
    const rows = await cloudPullReplied(workspaceId);
    const ids = rows.map((r) => r.tweet_id);
    await chrome.storage.local.set({
      [`${REPLIED_PREFIX}${workspaceId}`]: ids,
    });
  } catch (e) {
    logCloudError("pullRepliedForWorkspace", e);
  }
}

// Limpa profile_cache + workspaces sincronizados do storage local. Chamado no
// signOut pra nao deixar dados de um analista visivel pro proximo no mesmo
// device. Cache de sessao + grafo + setup_seen ficam (sao genericos).
export async function clearSyncedState(): Promise<void> {
  await chrome.storage.local.remove([
    KEYS.profileCache,
    KEYS.workspaces,
    KEYS.active,
  ]);
}
