import graphData from "../assets/node_metrics_index.json";
import type { GraphEntry } from "./types";

// Indice handle(lowercase) -> { isv, inferred_layer, is_poi }.
// Embarcado no bundle, lookup O(1).
const graph: Record<string, GraphEntry> = graphData as Record<string, GraphEntry>;

export function lookupHandle(handle: string): GraphEntry | undefined {
  if (!handle) return undefined;
  return graph[handle.toLowerCase()];
}

export function graphSize(): number {
  return Object.keys(graph).length;
}
