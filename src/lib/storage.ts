import { DEFAULT_CONFIG, type Config, type SessionCache } from "./types";

const KEYS = {
  config: "config",
  cache: "last_results_cache",
} as const;

// ---- Config ----

export async function getConfig(): Promise<Config> {
  const stored = await chrome.storage.local.get(KEYS.config);
  return { ...DEFAULT_CONFIG, ...(stored[KEYS.config] ?? {}) };
}

export async function saveConfig(config: Config): Promise<void> {
  await chrome.storage.local.set({ [KEYS.config]: config });
}

// As chaves sao embutidas (keys.ts); a unica config obrigatoria e a Lista.
export function isConfigComplete(config: Config): boolean {
  return Boolean(config.listId.trim());
}

// ---- Cache de sessao ----
// Guarda o resultado da ultima sessao pra reabrir o painel sem refazer a busca
// (economia de chamadas a TwitterAPI). Cada "atualizar" sobrescreve.

export async function getSessionCache(): Promise<SessionCache | null> {
  const stored = await chrome.storage.local.get(KEYS.cache);
  return (stored[KEYS.cache] as SessionCache) ?? null;
}

export async function saveSessionCache(cache: SessionCache): Promise<void> {
  await chrome.storage.local.set({ [KEYS.cache]: cache });
}

export async function clearSessionCache(): Promise<void> {
  await chrome.storage.local.remove(KEYS.cache);
}
