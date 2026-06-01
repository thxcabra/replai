import { useEffect, useState } from "preact/hooks";
import {
  clearSessionCache,
  getConfig,
  getSessionCache,
  isConfigComplete,
  saveConfig,
} from "../lib/storage";
import { runRefresh } from "../lib/orchestrator";
import { ApiError } from "../lib/errors";
import type { Config, RenderedTweet, SortBy } from "../lib/types";
import { Header } from "./components/Header";
import { Settings } from "./components/Settings";
import { TweetCard } from "./components/TweetCard";

interface LastRefresh {
  collected: number;
  passed: number;
  ts: number;
}

export function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [view, setView] = useState<"main" | "settings">("main");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [rendered, setRendered] = useState<RenderedTweet[]>([]);
  const [lastRefresh, setLastRefresh] = useState<LastRefresh | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("isv");

  useEffect(() => {
    (async () => {
      const cfg = await getConfig();
      setConfig(cfg);
      if (!isConfigComplete(cfg)) {
        setView("settings");
      }
      const cache = await getSessionCache();
      if (cache) {
        setRendered(cache.rendered);
        setLastRefresh({
          collected: cache.collected,
          passed: cache.passed,
          ts: cache.timestamp,
        });
      }
    })();
  }, []);

  async function handleSave(cfg: Config) {
    const listChanged = config !== null && config.listId !== cfg.listId;
    setConfig(cfg);
    await saveConfig(cfg);
    if (listChanged) {
      // lista nova: a sessao da lista antiga nao vale mais
      await clearSessionCache();
      setRendered([]);
      setLastRefresh(null);
    }
    if (isConfigComplete(cfg)) setView("main");
  }

  async function handleRefresh() {
    if (!config || !isConfigComplete(config)) {
      setView("settings");
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      // nova sessao: reseta e substitui os posts
      const outcome = await runRefresh(config);
      setRendered(outcome.rendered);
      setLastRefresh({
        collected: outcome.collected,
        passed: outcome.passed,
        ts: Date.now(),
      });
      if (outcome.message) setInfo(outcome.message);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError(`Erro inesperado: ${(e as Error).message ?? e}`);
      }
    } finally {
      setLoading(false);
    }
  }

  if (view === "settings" && config) {
    return (
      <Settings
        config={config}
        onSave={handleSave}
        onClose={isConfigComplete(config) ? () => setView("main") : null}
      />
    );
  }

  const sorted = [...rendered].sort((a, b) => {
    if (sortBy === "recent") {
      return (
        (Date.parse(b.tweet.timestamp ?? "") || 0) -
        (Date.parse(a.tweet.timestamp ?? "") || 0)
      );
    }
    if (sortBy === "poi") {
      if (b.tweet.is_poi !== a.tweet.is_poi)
        return b.tweet.is_poi - a.tweet.is_poi;
      return b.tweet.isv - a.tweet.isv;
    }
    return b.tweet.isv - a.tweet.isv;
  });

  return (
    <div class="min-h-screen">
      <Header
        collected={lastRefresh?.collected ?? null}
        passed={lastRefresh?.passed ?? null}
        windowHours={config?.timeWindowHours ?? null}
        lastRefreshTs={lastRefresh?.ts ?? null}
        loading={loading}
        onRefresh={handleRefresh}
        onOpenSettings={() => setView("settings")}
      />

      <div class="flex flex-col gap-3 p-3">
        {error && (
          <div class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {info && !error && (
          <div class="rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-300">
            {info}
          </div>
        )}

        {rendered.length > 0 && (
          <div class="flex items-center gap-2 text-xs text-zinc-400">
            <span>ordenar por</span>
            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy((e.target as HTMLSelectElement).value as SortBy)
              }
              class="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-sky-600"
            >
              <option value="isv">ISV (maior primeiro)</option>
              <option value="recent">mais recentes</option>
              <option value="poi">POI primeiro</option>
            </select>
          </div>
        )}

        {loading && rendered.length === 0 && (
          <div class="py-10 text-center text-sm text-zinc-500">
            puxando tweets e gerando replies...
          </div>
        )}

        {!loading && rendered.length === 0 && !error && !info && (
          <div class="py-10 text-center text-sm text-zinc-500">
            aperte <span class="text-sky-400">atualizar</span> pra puxar tweets
            da Lista.
          </div>
        )}

        {sorted.map((r) => (
          <TweetCard key={r.result.tweet_id} data={r} />
        ))}
      </div>
    </div>
  );
}
