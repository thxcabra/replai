import { LIMITS, TTLS } from "./constants";
import type { AuthorProfile, PostAnalysis } from "./types";

// V4.1.14 (CR-06): per-key storage no chrome.storage.local.
// Antes (V4.1.7): blob unico read-modify-write na cada operacao — race em
// concorrencia (analyzePost paralelo via Promise.all) sobrescrevia entries.
// Agora: cada cache entry e uma key independente. Escritas concorrentes
// nao colidem porque chrome.storage.local.set e atomica por key.
//
// Namespaces:
//   - ic_analysis:<hash>    → CacheEntry<PostAnalysis>  (24h TTL)
//   - ic_author:<handle>    → CacheEntry<AuthorProfile> (1h TTL)
//
// Eviction: chamada periodica de `evictExpired()` no boot do worker.
// Cap por namespace via LIMITS — ao exceder, drop oldest (Map insertion order).

const KEY_ANALYSIS_PREFIX = "ic_analysis:";
const KEY_AUTHOR_PREFIX = "ic_author:";

interface CacheEntry<T> {
  value: T;
  expires: number;
}

// ---- Hash key gerado pelo caller (intelligence.ts) ----

export function hashAnalysisKey(tweetId: string, text: string): string {
  return `${tweetId}:${text.length}:${text.slice(0, 32).replace(/\s/g, "_")}`;
}

// ---- Analysis cache ----

export async function getCachedAnalysis(
  key: string
): Promise<PostAnalysis | null> {
  const storageKey = KEY_ANALYSIS_PREFIX + key;
  const stored = await chrome.storage.local.get(storageKey);
  const entry = stored[storageKey] as CacheEntry<PostAnalysis> | undefined;
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    await chrome.storage.local.remove(storageKey);
    return null;
  }
  return entry.value;
}

export async function setCachedAnalysis(
  key: string,
  value: PostAnalysis
): Promise<void> {
  const storageKey = KEY_ANALYSIS_PREFIX + key;
  const entry: CacheEntry<PostAnalysis> = {
    value,
    expires: Date.now() + TTLS.ANALYSIS_MS,
  };
  // V4.1.14 (CR-06): write atomic — chrome.storage.local.set({ [key]: ... })
  // garante per-key consistency mesmo com Promise.all paralelo.
  await chrome.storage.local.set({ [storageKey]: entry });
}

// ---- Author profile cache ----

export async function getCachedAuthor(
  handle: string
): Promise<AuthorProfile | null> {
  const storageKey = KEY_AUTHOR_PREFIX + handle.toLowerCase();
  const stored = await chrome.storage.local.get(storageKey);
  const entry = stored[storageKey] as CacheEntry<AuthorProfile> | undefined;
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    await chrome.storage.local.remove(storageKey);
    return null;
  }
  return entry.value;
}

export async function setCachedAuthors(
  profiles: AuthorProfile[]
): Promise<void> {
  if (profiles.length === 0) return;
  const now = Date.now();
  const writes: Record<string, CacheEntry<AuthorProfile>> = {};
  for (const p of profiles) {
    writes[KEY_AUTHOR_PREFIX + p.handle.toLowerCase()] = {
      value: p,
      expires: now + TTLS.AUTHOR_PROFILE_MS,
    };
  }
  // Single chrome.storage.local.set call com varios keys = atomico no nivel
  // de cada key. Sem race com outras escritas concorrentes.
  await chrome.storage.local.set(writes);
}

export async function invalidateAuthor(handle: string): Promise<void> {
  await chrome.storage.local.remove(KEY_AUTHOR_PREFIX + handle.toLowerCase());
}

// ---- Periodic eviction (chamada no boot do worker, opcional) ----
//
// Como cada entry tem TTL embutido, leituras stale ja sao auto-evictadas.
// Esta funcao limpa keys expiradas que nunca foram lidas (storage limit).
// Tambem cap por namespace.

export async function evictExpired(): Promise<{
  analysisRemoved: number;
  authorsRemoved: number;
}> {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const toRemove: string[] = [];
  let analysisKept = 0;
  const analysisKeys: { key: string; expires: number }[] = [];
  let authorsKept = 0;
  const authorsKeys: { key: string; expires: number }[] = [];

  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(KEY_ANALYSIS_PREFIX)) {
      const entry = v as CacheEntry<unknown> | undefined;
      if (!entry || entry.expires < now) {
        toRemove.push(k);
      } else {
        analysisKept++;
        analysisKeys.push({ key: k, expires: entry.expires });
      }
    } else if (k.startsWith(KEY_AUTHOR_PREFIX)) {
      const entry = v as CacheEntry<unknown> | undefined;
      if (!entry || entry.expires < now) {
        toRemove.push(k);
      } else {
        authorsKept++;
        authorsKeys.push({ key: k, expires: entry.expires });
      }
    }
  }

  // Cap por namespace: drop oldest expires se ultrapassou o cap
  const analysisCap = LIMITS.MAX_ANALYSIS_CACHE;
  if (analysisKept > analysisCap) {
    analysisKeys.sort((a, b) => a.expires - b.expires);
    for (const k of analysisKeys.slice(0, analysisKept - analysisCap)) {
      toRemove.push(k.key);
    }
  }
  // Authors: usamos o mesmo cap (1000 deve ser suficiente, autores e set finito)
  if (authorsKept > analysisCap) {
    authorsKeys.sort((a, b) => a.expires - b.expires);
    for (const k of authorsKeys.slice(0, authorsKept - analysisCap)) {
      toRemove.push(k.key);
    }
  }

  if (toRemove.length > 0) {
    await chrome.storage.local.remove(toRemove);
  }

  const analysisRemoved = toRemove.filter((k) =>
    k.startsWith(KEY_ANALYSIS_PREFIX)
  ).length;
  const authorsRemoved = toRemove.filter((k) =>
    k.startsWith(KEY_AUTHOR_PREFIX)
  ).length;
  return { analysisRemoved, authorsRemoved };
}
