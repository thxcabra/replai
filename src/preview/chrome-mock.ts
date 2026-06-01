import { DEFAULT_CONFIG } from "../lib/types";
import { MOCK_RENDERED } from "./mock-data";

// Mock minimo do chrome.* pra rodar a UI fora da extensao (preview no browser).
// Backing em localStorage: a chave real que voce colar nas configs persiste
// entre reloads. dryRun ligado: "atualizar" puxa e filtra sem chamar a Anthropic.

const LS_KEY = "replai_preview_store_v3";

const SEED: Record<string, unknown> = {
  // chaves sao embutidas (keys.ts); config so tem a Lista e os filtros.
  config: { ...DEFAULT_CONFIG },
  seen_tweet_ids: {},
  last_results_cache: {
    timestamp: Date.now() - 2 * 60 * 1000,
    collected: 79,
    passed: MOCK_RENDERED.length,
    rendered: MOCK_RENDERED,
  },
};

function load(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignora */
  }
  return JSON.parse(JSON.stringify(SEED));
}

const store = load();

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  } catch {
    /* ignora */
  }
}

function pick(keys: string | string[] | null): Record<string, unknown> {
  if (keys === null || keys === undefined) return { ...store };
  const list = Array.isArray(keys) ? keys : [keys];
  const out: Record<string, unknown> = {};
  for (const k of list) if (k in store) out[k] = store[k];
  return out;
}

(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      async get(keys: string | string[] | null) {
        return pick(keys);
      },
      async set(obj: Record<string, unknown>) {
        Object.assign(store, obj);
        persist();
      },
      async remove(keys: string | string[]) {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) delete store[k];
        persist();
      },
    },
  },
  tabs: {
    async create({ url }: { url: string }) {
      window.open(url, "_blank");
    },
  },
};
