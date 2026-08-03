import { useEffect, useState } from "preact/hooks";
import { categoryLabel } from "../../lib/constants";
import {
  exportActivityJson,
  fetchDashboardData,
  type DashboardData,
} from "../../lib/dashboard";

interface Props {
  workspaceId: string | null;
  workspaceName: string | null;
  onClose: () => void;
  // V4.1.5: quando renderizado dentro do HistoricoView (sub-tab), suprime
  // header proprio (HistoricoView ja tem header global).
  embedded?: boolean;
}

export function Dashboard({
  workspaceId,
  workspaceName,
  onClose,
  embedded = false,
}: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<"workspace" | "all">("workspace");
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setError(null);
    setExporting(true);
    try {
      const payload = await exportActivityJson(
        scope === "workspace" ? workspaceId : null
      );
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = payload.exported_at.replace(/[:.]/g, "-").slice(0, 19);
      const scopeName =
        scope === "workspace" && workspaceName
          ? workspaceName.replace(/[^a-z0-9_-]/gi, "_")
          : "all";
      a.download = `replai-activity-${scopeName}-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Erro exportando: ${(e as Error).message ?? e}`);
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    // V4.1.14 (WR-14): cancelled flag pra evitar setState em fetch antigo
    // quando workspace/scope muda mid-flight.
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchDashboardData(scope === "workspace" ? workspaceId : null)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled)
          setError(`Erro carregando dashboard: ${(e as Error).message ?? e}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, scope]);

  // Spread em array vazio retorna -Infinity em Math.max; guardamos com fallback.
  const dayCounts = data?.by_day_14d.map((d) => d.count) ?? [];
  const catCounts = data?.top_categories.map((c) => c.count) ?? [];
  const max = dayCounts.length > 0 ? Math.max(1, ...dayCounts) : 1;
  const maxCat = catCounts.length > 0 ? Math.max(1, ...catCounts) : 1;

  return (
    <div class="flex flex-col gap-4 p-3">
      <div class="flex items-center justify-between">
        {!embedded && (
          <h2 class="text-sm font-semibold text-zinc-200">Atividade</h2>
        )}
        <div class={`flex gap-1.5 ${embedded ? "ml-auto" : ""}`}>
          <button
            onClick={handleExport}
            disabled={exporting || loading}
            title="baixa JSON com replied_tweets + reply_logs + events dos ultimos 90 dias"
            class="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            {exporting ? "..." : "exportar JSON"}
          </button>
          {!embedded && (
            <button
              onClick={onClose}
              class="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
            >
              voltar
            </button>
          )}
        </div>
      </div>

      <div class="flex gap-1.5 text-xs">
        <button
          onClick={() => setScope("workspace")}
          disabled={!workspaceId}
          class={`rounded border px-2 py-1 ${
            scope === "workspace"
              ? "border-sky-600 bg-sky-600/20 text-sky-200"
              : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
          } disabled:opacity-50`}
        >
          este workspace{workspaceName ? ` (${workspaceName})` : ""}
        </button>
        <button
          onClick={() => setScope("all")}
          class={`rounded border px-2 py-1 ${
            scope === "all"
              ? "border-sky-600 bg-sky-600/20 text-sky-200"
              : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
          }`}
        >
          todos workspaces
        </button>
      </div>

      {loading && (
        <div class="py-10 text-center text-sm text-zinc-500">carregando...</div>
      )}

      {error && (
        <div class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* Totais */}
          <div class="grid grid-cols-3 gap-2">
            <Stat label="semana" value={data.totals.week} />
            <Stat label="30 dias" value={data.totals.month} />
            <Stat label="total" value={data.totals.all_time} />
          </div>

          {/* Taxas */}
          <div class="grid grid-cols-2 gap-2">
            <Stat
              label="editadas"
              value={`${data.rates.edited_pct}%`}
              hint="das replies disparadas"
            />
            <Stat
              label="confirmadas"
              value={`${data.rates.confirmed_pct}%`}
              hint="usuario confirmou postagem"
            />
          </div>

          {/* Tempo medio */}
          {data.avg_session_minutes !== null && (
            <Stat
              label="tempo medio por sessao"
              value={`${data.avg_session_minutes}min`}
              hint="do clique 'atualizar' ate a chamada do LLM"
            />
          )}

          {/* Top categorias */}
          <div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
            <div class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              top categorias (30d)
            </div>
            {data.top_categories.length === 0 ? (
              <div class="text-[11px] text-zinc-500">sem dados ainda.</div>
            ) : (
              <div class="flex flex-col gap-1.5">
                {data.top_categories.map((c) => (
                  <div key={c.category} class="flex items-center gap-2 text-xs">
                    <span class="w-32 truncate text-zinc-200">
                      {categoryLabel(c.category)}
                    </span>
                    <div class="relative h-3 flex-1 rounded bg-zinc-800">
                      <div
                        class="h-full rounded bg-sky-600"
                        style={{ width: `${(c.count / maxCat) * 100}%` }}
                      />
                    </div>
                    <span class="w-8 text-right tabular-nums text-zinc-400">
                      {c.count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Replies por dia (14d) */}
          <div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
            <div class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              replies por dia (14d)
            </div>
            <div class="flex h-24 items-end gap-1">
              {data.by_day_14d.map((d) => (
                <div
                  key={d.date}
                  class="group relative flex flex-1 flex-col items-center justify-end"
                  title={`${d.date}: ${d.count}`}
                >
                  <div
                    class="w-full rounded-t bg-sky-600/70 transition-colors hover:bg-sky-500"
                    style={{ height: `${(d.count / max) * 100}%` }}
                  />
                </div>
              ))}
            </div>
            <div class="mt-1 flex justify-between text-[10px] text-zinc-500">
              <span>{data.by_day_14d[0]?.date.slice(5) ?? ""}</span>
              <span>
                {data.by_day_14d[data.by_day_14d.length - 1]?.date.slice(5) ?? ""}
              </span>
            </div>
          </div>

          <div class="text-[10px] text-zinc-500">
            {data.events_in_window} eventos nos ultimos 14 dias.
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
      <div class="text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div class="text-xl font-bold tabular-nums text-zinc-100">{value}</div>
      {hint && <div class="text-[10px] text-zinc-500">{hint}</div>}
    </div>
  );
}
