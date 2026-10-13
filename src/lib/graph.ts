import type { Graph, GraphEntry, GraphMeta } from "./types";

// Grafo bundled no build. Fallback global quando o workspace ativo nao tem CSV
// uploaded. O indice real (node_metrics_index.json) e privado e fica fora do
// git; sem ele, o build usa o sample versionado com handles ficticios.
const GRAPHS = import.meta.glob<Graph>("../assets/node_metrics_index*.json", {
  eager: true,
  import: "default",
});
const BUNDLED: Graph =
  GRAPHS["../assets/node_metrics_index.json"] ??
  GRAPHS["../assets/node_metrics_index.sample.json"];

const PREFIX = "graph_";

interface StoredGraph {
  data: Graph;
  meta: GraphMeta;
}

// Carrega o grafo ativo do workspace: uploaded se houver, senao o bundled.
export async function loadGraph(workspaceId: string): Promise<Graph> {
  const key = `${PREFIX}${workspaceId}`;
  const stored = await chrome.storage.local.get(key);
  const uploaded = stored[key] as StoredGraph | undefined;
  return uploaded?.data ?? BUNDLED;
}

// Meta do grafo ativo do workspace. `null` quando esta usando o bundled.
export async function getGraphMeta(
  workspaceId: string
): Promise<GraphMeta | null> {
  const key = `${PREFIX}${workspaceId}`;
  const stored = await chrome.storage.local.get(key);
  const uploaded = stored[key] as StoredGraph | undefined;
  return uploaded?.meta ?? null;
}

// Persiste um grafo uploaded pro workspace e retorna sua meta.
export async function saveUploadedGraph(
  workspaceId: string,
  data: Graph,
  filename: string
): Promise<GraphMeta> {
  const handles = Object.keys(data);
  const meta: GraphMeta = {
    filename,
    uploadedAt: Date.now(),
    handleCount: handles.length,
    poiCount: handles.filter((h) => data[h].is_poi === 1).length,
  };
  await chrome.storage.local.set({
    [`${PREFIX}${workspaceId}`]: { data, meta } as StoredGraph,
  });
  return meta;
}

export async function clearUploadedGraph(workspaceId: string): Promise<void> {
  await chrome.storage.local.remove(`${PREFIX}${workspaceId}`);
}

// Lookup helper: aceita handle possivelmente vazio/com @, devolve a entrada
// se existir. Usado pelo prefilter durante a triagem.
export function lookupHandle(
  graph: Graph,
  handle: string | undefined
): GraphEntry | undefined {
  if (!handle) return undefined;
  const norm = handle.toLowerCase().replace(/^@/, "");
  return graph[norm];
}

// Tamanho do grafo bundled (estatico). Usado pra mostrar "X mapeados" quando
// o workspace nao tem grafo uploaded.
export function bundledGraphSize(): number {
  return Object.keys(BUNDLED).length;
}
