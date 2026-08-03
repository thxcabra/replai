// V6 — Historico LinkedIn (simetria com MyRepliesView do X).
//
// Le linkedin_replies filtrado por workspace + status (posted/skipped/edited).
// Analista revisa o que ja mandou, filtra por Bridge/POI, ve custo LLM.
//
// Escopo intencionalmente enxuto neste primeiro cut — Analytics rich fica
// no LinkedInAnalyticsView (Cost + Impact map). Aqui e "vitrine" de replies.

import { useEffect, useMemo, useState } from "preact/hooks";
import type { JSX } from "preact";
import { supabase, isSupabaseConfigured } from "../../../lib/supabase";
import type { Workspace } from "../../../lib/types";
import { ViewShell } from "../../ui/ViewShell";

interface Props {
  workspace: Workspace;
  onBack: () => void;
}

interface LnReplyRow {
  id: string;
  bridge_id: string | null;
  poi_target_id: string | null;
  poi_target_name: string | null;
  post_author_name: string | null;
  post_url: string | null;
  reply_text: string;
  reply_category: string | null;
  decision: string | null;
  posted_at: string | null;
  logged_at: string;
  llm_cost_usd: number | null;
  strategy_note: string | null;
}

type Filter = "all" | "posted" | "skipped";

export function LinkedInHistoricoView({
  workspace,
  onBack,
}: Props): JSX.Element {
  const [rows, setRows] = useState<LnReplyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!isSupabaseConfigured()) {
        setRows([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase
        .from("linkedin_replies")
        .select(
          "id, bridge_id, poi_target_id, poi_target_name, post_author_name, post_url, reply_text, reply_category, decision, posted_at, logged_at, llm_cost_usd, strategy_note"
        )
        .eq("workspace_id", workspace.id)
        .order("logged_at", { ascending: false })
        .limit(100);
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setRows([]);
      } else {
        setRows((data ?? []) as LnReplyRow[]);
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [workspace.id]);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => r.decision === filter);
  }, [rows, filter]);

  const totalCost = useMemo(() => {
    return rows.reduce((acc, r) => acc + (r.llm_cost_usd ?? 0), 0);
  }, [rows]);

  return (
    <ViewShell
      title="Historico LinkedIn"
      subtitle={`${rows.length} reply(s) — custo total ${formatCost(totalCost)}`}
      channel="linkedin"
      onBack={onBack}
    >
      <div class="flex flex-col gap-2 p-3">
        <div role="tablist" class="flex gap-1">
          <FilterChip
            active={filter === "all"}
            onClick={() => setFilter("all")}
            count={rows.length}
          >
            todos
          </FilterChip>
          <FilterChip
            active={filter === "posted"}
            onClick={() => setFilter("posted")}
            count={rows.filter((r) => r.decision === "posted").length}
          >
            postados
          </FilterChip>
          <FilterChip
            active={filter === "skipped"}
            onClick={() => setFilter("skipped")}
            count={rows.filter((r) => r.decision === "skipped").length}
          >
            skipped
          </FilterChip>
        </div>

        {loading && (
          <div class="rounded border border-zinc-800 bg-zinc-900/40 p-3 text-center text-xs text-zinc-500">
            carregando historico...
          </div>
        )}
        {error && (
          <div class="rounded border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
            erro: {error}
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div class="rounded border border-zinc-800 bg-zinc-900/40 p-3 text-center text-xs text-zinc-500">
            nenhuma reply neste filtro ainda.
          </div>
        )}
        <ul class="flex flex-col gap-2">
          {filtered.map((r) => (
            <LnReplyRowCard key={r.id} row={r} />
          ))}
        </ul>
      </div>
    </ViewShell>
  );
}

function FilterChip({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: JSX.Element | string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      class={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
        active
          ? "border-sky-500 bg-sky-500/10 text-sky-200"
          : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
      }`}
    >
      {children}
      <span class="rounded bg-zinc-800/70 px-1 text-[9px] tabular-nums text-zinc-400">
        {count}
      </span>
    </button>
  );
}

function LnReplyRowCard({ row }: { row: LnReplyRow }): JSX.Element {
  return (
    <li class="rounded-md border border-zinc-800 bg-zinc-900/50 p-2.5">
      <div class="mb-1 flex items-baseline justify-between gap-2 text-[10px] text-zinc-500">
        <span>
          {row.post_author_name ?? "bridge"} → {row.poi_target_name ?? "poi"}
        </span>
        <span>
          {row.decision && (
            <span
              class={`mr-2 rounded px-1 py-[1px] text-[9px] uppercase tracking-wide ${
                row.decision === "posted"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : row.decision === "skipped"
                    ? "bg-zinc-700 text-zinc-400"
                    : "bg-amber-500/20 text-amber-300"
              }`}
            >
              {row.decision}
            </span>
          )}
          {formatCost(row.llm_cost_usd)}
        </span>
      </div>
      <p class="whitespace-pre-line text-[11px] leading-relaxed text-zinc-200">
        {row.reply_text}
      </p>
      {row.strategy_note && (
        <p class="mt-1 text-[10px] italic text-zinc-500">
          {row.strategy_note}
        </p>
      )}
      {row.post_url && (
        <a
          href={row.post_url}
          target="_blank"
          rel="noopener noreferrer"
          class="mt-1 inline-block text-[10px] text-sky-400 hover:text-sky-300"
        >
          post original ↗
        </a>
      )}
    </li>
  );
}

function formatCost(cost: number | null): string {
  if (cost == null) return "—";
  if (cost < 0.0001) return "<$0.0001";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}
