import { useEffect, useState } from "preact/hooks";
import {
  clearSessionCache,
  createWorkspace,
  deleteWorkspace,
  exportWorkspace,
  getActiveWorkspace,
  getRepliedIds,
  getSessionCache,
  getWorkspace,
  importWorkspace,
  isConfigComplete,
  listWorkspaces,
  renameWorkspace,
  saveSessionCache,
  saveWorkspace,
  setActiveWorkspaceId,
  setReplied,
} from "../lib/storage";
import { runQuickTest, runRefresh } from "../lib/orchestrator";
import { ApiError } from "../lib/errors";
import type {
  Config,
  RenderedTweet,
  SortBy,
  Workspace,
  WorkspaceMeta,
} from "../lib/types";
import { Header } from "./components/Header";
import { Settings } from "./components/Settings";
import { TweetCard } from "./components/TweetCard";

interface LastRefresh {
  collected: number;
  passed: number;
  ts: number;
}

export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceMeta[]>([]);
  const [view, setView] = useState<"main" | "settings">("main");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [rendered, setRendered] = useState<RenderedTweet[]>([]);
  const [lastRefresh, setLastRefresh] = useState<LastRefresh | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("isv");
  // Cooldown pos-refresh: bloqueia o botao por 30s pra evitar duplo-clique
  // que queima cota da TwitterAPI (pay-per-use).
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  // tweets marcados como respondidos pelo analista (por workspace).
  const [repliedIds, setRepliedIds] = useState<string[]>([]);
  // quick test: URL de um tweet pra testar a pipeline so nele.
  const [quickTestUrl, setQuickTestUrl] = useState("");
  const [showQuickTest, setShowQuickTest] = useState(false);

  useEffect(() => {
    if (!cooldownUntil) return;
    const i = setInterval(() => {
      const t = Date.now();
      setNowTick(t);
      if (t >= cooldownUntil) setCooldownUntil(null);
    }, 500);
    return () => clearInterval(i);
  }, [cooldownUntil]);

  const cooldownSecs = cooldownUntil
    ? Math.max(0, Math.ceil((cooldownUntil - nowTick) / 1000))
    : 0;

  useEffect(() => {
    (async () => {
      const ws = await getActiveWorkspace();
      setWorkspace(ws);
      const list = await listWorkspaces();
      setWorkspaces(list);
      if (!isConfigComplete(ws.config)) {
        setView("settings");
      }
      const cache = await getSessionCache(ws.id);
      if (cache) {
        setRendered(cache.rendered);
        setLastRefresh({
          collected: cache.collected,
          passed: cache.passed,
          ts: cache.timestamp,
        });
      }
      setRepliedIds(await getRepliedIds(ws.id));
    })();
  }, []);

  // Edicao de config do workspace ativo. Se o listId mudou, o cache de sessao
  // do workspace nao vale mais.
  async function handleSaveConfig(cfg: Config) {
    if (!workspace) return;
    const listChanged = workspace.config.listId !== cfg.listId;
    const updated: Workspace = { ...workspace, config: cfg };
    setWorkspace(updated);
    await saveWorkspace(updated);
    if (listChanged) {
      await clearSessionCache(updated.id);
      setRendered([]);
      setLastRefresh(null);
    }
    if (isConfigComplete(cfg)) setView("main");
  }

  async function handleSwitchWorkspace(id: string) {
    if (!workspace || id === workspace.id) return;
    const next = await getWorkspace(id);
    if (!next) return;
    await setActiveWorkspaceId(id);
    setWorkspace(next);
    setError(null);
    setInfo(null);
    // troca tambem o cache renderizado pro do novo workspace
    const cache = await getSessionCache(id);
    if (cache) {
      setRendered(cache.rendered);
      setLastRefresh({
        collected: cache.collected,
        passed: cache.passed,
        ts: cache.timestamp,
      });
    } else {
      setRendered([]);
      setLastRefresh(null);
    }
    setRepliedIds(await getRepliedIds(id));
  }

  async function handleExportWorkspace() {
    if (!workspace) return;
    const data = await exportWorkspace(workspace.id);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = workspace.name.replace(/[^a-z0-9_-]/gi, "_");
    a.download = `replai-workspace-${safeName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleImportWorkspace(file: File) {
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const imported = await importWorkspace(payload);
      await setActiveWorkspaceId(imported.id);
      setWorkspace(imported);
      await refreshWorkspaceList();
      setRendered([]);
      setLastRefresh(null);
      setRepliedIds([]);
      setError(null);
      setInfo(`workspace "${imported.name}" importado.`);
    } catch (e) {
      setError(`Erro importando workspace: ${(e as Error).message ?? e}`);
    }
  }

  async function handleToggleReplied(tweetId: string) {
    if (!workspace) return;
    const isReplied = repliedIds.includes(tweetId);
    const next = await setReplied(workspace.id, tweetId, !isReplied);
    setRepliedIds(next);
  }

  async function refreshWorkspaceList() {
    const list = await listWorkspaces();
    setWorkspaces(list);
  }

  async function handleCreateWorkspace(name: string, duplicate: boolean) {
    const sourceId = duplicate && workspace ? workspace.id : undefined;
    const fresh = await createWorkspace(name, sourceId);
    await setActiveWorkspaceId(fresh.id);
    setWorkspace(fresh);
    await refreshWorkspaceList();
    // workspace novo: comeca sem cache nem replied
    setRendered([]);
    setLastRefresh(null);
    setRepliedIds([]);
    setError(null);
    setInfo(null);
  }

  async function handleRenameWorkspace(name: string) {
    if (!workspace) return;
    await renameWorkspace(workspace.id, name);
    const updated = { ...workspace, name };
    setWorkspace(updated);
    await refreshWorkspaceList();
  }

  async function handleDeleteWorkspace() {
    if (!workspace) return;
    const newActiveId = await deleteWorkspace(workspace.id);
    const next = await getWorkspace(newActiveId);
    if (next) setWorkspace(next);
    await refreshWorkspaceList();
    const cache = await getSessionCache(newActiveId);
    if (cache) {
      setRendered(cache.rendered);
      setLastRefresh({
        collected: cache.collected,
        passed: cache.passed,
        ts: cache.timestamp,
      });
    } else {
      setRendered([]);
      setLastRefresh(null);
    }
    setRepliedIds(await getRepliedIds(newActiveId));
    setError(null);
    setInfo(null);
  }

  // Persiste edits inline das replies. Atualiza o `rendered` em memoria e
  // sobrescreve o cache de sessao do workspace ativo, pra que fechar e reabrir
  // o painel mantenha o que o analista escreveu.
  async function handleReplyEdit(
    tweetId: string,
    replyIdx: number,
    text: string
  ) {
    if (!workspace) return;
    const updated = rendered.map((r) => {
      if (r.result.tweet_id !== tweetId) return r;
      const newReplies = r.result.replies.map((rep, i) =>
        i === replyIdx ? { ...rep, text } : rep
      );
      return { ...r, result: { ...r.result, replies: newReplies } };
    });
    setRendered(updated);
    if (lastRefresh) {
      await saveSessionCache(workspace.id, {
        timestamp: lastRefresh.ts,
        collected: lastRefresh.collected,
        passed: lastRefresh.passed,
        rendered: updated,
      });
    }
  }

  async function handleQuickTest() {
    if (!workspace || !quickTestUrl.trim()) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const outcome = await runQuickTest(workspace, quickTestUrl.trim());
      setRendered(outcome.rendered);
      setLastRefresh({
        collected: outcome.collected,
        passed: outcome.passed,
        ts: Date.now(),
      });
      if (outcome.message) setInfo(outcome.message);
      setCooldownUntil(Date.now() + 30_000);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else setError(`Erro inesperado: ${(e as Error).message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    if (!workspace || !isConfigComplete(workspace.config)) {
      setView("settings");
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const outcome = await runRefresh(workspace);
      setRendered(outcome.rendered);
      setLastRefresh({
        collected: outcome.collected,
        passed: outcome.passed,
        ts: Date.now(),
      });
      if (outcome.message) setInfo(outcome.message);
      // sucesso: aplica cooldown de 30s pro proximo atualizar
      setCooldownUntil(Date.now() + 30_000);
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

  if (view === "settings" && workspace) {
    return (
      <Settings
        workspace={workspace}
        workspaces={workspaces}
        onSaveConfig={handleSaveConfig}
        onCreateWorkspace={handleCreateWorkspace}
        onRenameWorkspace={handleRenameWorkspace}
        onDeleteWorkspace={handleDeleteWorkspace}
        onExportWorkspace={handleExportWorkspace}
        onImportWorkspace={handleImportWorkspace}
        onClose={isConfigComplete(workspace.config) ? () => setView("main") : null}
      />
    );
  }

  const repliedSet = new Set(repliedIds);
  const sorted = [...rendered].sort((a, b) => {
    // respondidos sempre vao pro final, independente do criterio
    const aR = repliedSet.has(a.result.tweet_id);
    const bR = repliedSet.has(b.result.tweet_id);
    if (aR !== bR) return aR ? 1 : -1;
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
        workspace={workspace}
        workspaces={workspaces}
        onSwitchWorkspace={handleSwitchWorkspace}
        collected={lastRefresh?.collected ?? null}
        passed={lastRefresh?.passed ?? null}
        windowHours={workspace?.config.timeWindowHours ?? null}
        lastRefreshTs={lastRefresh?.ts ?? null}
        loading={loading}
        cooldownSecs={cooldownSecs}
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

        {/* Quick test: testa a pipeline num tweet especifico */}
        <details
          open={showQuickTest}
          onToggle={(e) =>
            setShowQuickTest((e.target as HTMLDetailsElement).open)
          }
          class="rounded border border-zinc-800 bg-zinc-900/40"
        >
          <summary class="cursor-pointer list-none select-none px-2.5 py-1.5 text-[11px] text-zinc-400 hover:bg-zinc-800/40 [&::-webkit-details-marker]:hidden">
            <span class="inline-block w-2 transition-transform group-open:rotate-90">
              ›
            </span>{" "}
            testar um tweet especifico
          </summary>
          <div class="flex flex-col gap-1.5 p-2.5 pt-1">
            <input
              type="text"
              class="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-sky-600"
              placeholder="cole URL do tweet (https://x.com/user/status/...)"
              value={quickTestUrl}
              onInput={(e) =>
                setQuickTestUrl((e.target as HTMLInputElement).value)
              }
            />
            <button
              type="button"
              onClick={handleQuickTest}
              disabled={loading || cooldownSecs > 0 || !quickTestUrl.trim()}
              class="self-start rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading
                ? "..."
                : cooldownSecs > 0
                  ? `${cooldownSecs}s`
                  : "rodar quick test"}
            </button>
            <div class="text-[10px] text-zinc-500">
              pula o prefilter da Lista. roda a pipeline so neste tweet
              (substitui o cache da sessao atual).
            </div>
          </div>
        </details>

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
          <TweetCard
            key={r.result.tweet_id}
            data={r}
            replied={repliedIds.includes(r.result.tweet_id)}
            onToggleReplied={() => handleToggleReplied(r.result.tweet_id)}
            onReplyEdit={(idx, text) =>
              handleReplyEdit(r.result.tweet_id, idx, text)
            }
          />
        ))}
      </div>
    </div>
  );
}
