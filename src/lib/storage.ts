import {
  DEFAULT_CONFIG,
  type Config,
  type SessionCache,
  type Workspace,
  type WorkspaceMeta,
} from "./types";

// Chaves do chrome.storage.local. Layout atual:
// - active_workspace_id: string
// - workspaces: { [id]: Workspace }
// - cache_<workspaceId>: SessionCache  (separado pra nao reescrever toda a
//     workspace dict em cada refresh)
// - graph_<workspaceId>: { data, meta }  (ver graph.ts)
//
// Layout legado (pre-fase-3): config, last_results_cache, uploaded_graph
// como chaves top-level. A migracao roda no primeiro acesso.
const KEYS = {
  active: "active_workspace_id",
  workspaces: "workspaces",
} as const;

const CACHE_PREFIX = "cache_";
const GRAPH_PREFIX = "graph_";

const DEFAULT_WS_ID = "ws_default";

function newWorkspaceId(): string {
  // ws_ + 6 chars base36 (~36^6 = 2.1B, suficiente)
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  return `ws_${rand}`;
}

// Roda no primeiro acesso. Se ja existe active_workspace_id, e no-op.
// Se ha config legado, cria um workspace "Default" carregando a config
// existente e move o cache/grafo pra dentro dele. Sem perda de dados.
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
    if (stored[KEYS.active]) return; // ja migrou

    const legacyConfig = stored.config as Partial<Config> | undefined;
    const ws: Workspace = {
      id: DEFAULT_WS_ID,
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

// ---- Workspaces ----

export async function getActiveWorkspaceId(): Promise<string> {
  await migrateIfNeeded();
  const stored = await chrome.storage.local.get(KEYS.active);
  return (stored[KEYS.active] as string) ?? DEFAULT_WS_ID;
}

export async function setActiveWorkspaceId(id: string): Promise<void> {
  await chrome.storage.local.set({ [KEYS.active]: id });
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
  return workspaces[id] ?? null;
}

// Versao tolerante: garante que sempre ha um workspace ativo valido.
// Se o active_workspace_id apontar pra um id que nao existe (storage
// corrompida), cria um Default fresco e ativa.
export async function getActiveWorkspace(): Promise<Workspace> {
  const id = await getActiveWorkspaceId();
  const ws = await getWorkspace(id);
  if (ws) return ws;

  const fallback: Workspace = {
    id: DEFAULT_WS_ID,
    name: "Default",
    createdAt: Date.now(),
    config: { ...DEFAULT_CONFIG },
  };
  await saveWorkspace(fallback);
  await setActiveWorkspaceId(fallback.id);
  return fallback;
}

export async function saveWorkspace(ws: Workspace): Promise<void> {
  const stored = await chrome.storage.local.get(KEYS.workspaces);
  const workspaces =
    (stored[KEYS.workspaces] as Record<string, Workspace>) ?? {};
  workspaces[ws.id] = ws;
  await chrome.storage.local.set({ [KEYS.workspaces]: workspaces });
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
  }

  const ws: Workspace = {
    id,
    name: name.trim() || "novo workspace",
    createdAt: Date.now(),
    config,
  };
  await saveWorkspace(ws);

  // Se duplicou, copia tambem o grafo uploaded (mas nao o cache da sessao)
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
    const fresh: Workspace = {
      id: DEFAULT_WS_ID,
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

  return newActiveId;
}

// ---- Validacao de config ----
// Mantido como funcao pura pra UI checar antes de "atualizar".
export function isConfigComplete(config: Config): boolean {
  return Boolean(config.listId.trim());
}

// ---- Cache de sessao (por workspace) ----

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

// Exporta um workspace como JSON: config + grafo uploaded (se houver).
// Cache de sessao e replied-ids NAO sao exportados (sao locais de uso).
export async function exportWorkspace(id: string): Promise<ExportedWorkspace> {
  const ws = await getWorkspace(id);
  if (!ws) throw new Error("Workspace nao existe.");
  const graphKey = `${GRAPH_PREFIX}${id}`;
  const stored = await chrome.storage.local.get(graphKey);
  const graph = stored[graphKey] as
    | { data: unknown; meta: unknown }
    | undefined;
  return {
    version: 1,
    name: ws.name,
    exportedAt: Date.now(),
    config: ws.config,
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
// Lista de tweet_ids que o analista marcou como ja-respondidos. Usado pra
// esmaecer o card na UI (nao remove - o analista pode desmarcar).

const REPLIED_PREFIX = "replied_";

export async function getRepliedIds(workspaceId: string): Promise<string[]> {
  const key = `${REPLIED_PREFIX}${workspaceId}`;
  const stored = await chrome.storage.local.get(key);
  return (stored[key] as string[]) ?? [];
}

export async function setReplied(
  workspaceId: string,
  tweetId: string,
  replied: boolean
): Promise<string[]> {
  const ids = await getRepliedIds(workspaceId);
  const set = new Set(ids);
  if (replied) set.add(tweetId);
  else set.delete(tweetId);
  const next = [...set];
  await chrome.storage.local.set({
    [`${REPLIED_PREFIX}${workspaceId}`]: next,
  });
  return next;
}
