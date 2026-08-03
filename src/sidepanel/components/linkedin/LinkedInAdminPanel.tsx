// V5 — Admin panel LinkedIn.
//
// UX principios:
// - Data density: 2 sections (Cost + Impact) com bordas explicitas — evita "wall of numbers"
// - Semantic color pra warning threshold (mes atual > alerta)
// - Tabular-nums em toda coluna numerica (typography rule)
// - Empty state com guidance (Material Design empty-data-state)
// - Aria labels em toda peca de dados

import { useEffect, useMemo, useState } from "preact/hooks";
import { APIFY } from "../../../lib/constants";
import { supabase } from "../../../lib/supabase";

interface ApifyRunAggregate {
  user_email: string;
  runs_month: number;
  runs_cached_month: number;
  cost_month: number;
  runs_today: number;
  cost_today: number;
}

interface ImpactStat {
  poi_id: string;
  poi_name: string;
  touches_month: number;
  bridges_used: number;
  posted_replies: number;
}

interface Props {
  workspaceId?: string; // opcional — se null, agregado do time
}

export function LinkedInAdminPanel({ workspaceId }: Props) {
  const [tab, setTab] = useState<"cost" | "impact">("cost");
  return (
    <section aria-labelledby="linkedin-admin-heading" class="flex flex-col gap-3">
      <header class="flex items-center justify-between gap-2 border-b border-zinc-800 pb-2">
        <h2 id="linkedin-admin-heading" class="text-sm font-semibold text-zinc-200">
          LinkedIn · {workspaceId ? "workspace" : "time"}
        </h2>
        <div
          role="tablist"
          aria-label="secoes LinkedIn admin"
          class="flex gap-0.5 rounded border border-zinc-800 bg-zinc-900 p-0.5"
        >
          <TabBtn
            active={tab === "cost"}
            onClick={() => setTab("cost")}
            controls="tab-cost"
          >
            custo APIFY
          </TabBtn>
          <TabBtn
            active={tab === "impact"}
            onClick={() => setTab("impact")}
            controls="tab-impact"
          >
            impact map
          </TabBtn>
        </div>
      </header>

      {tab === "cost" ? (
        <CostSection workspaceId={workspaceId} />
      ) : (
        <ImpactSection workspaceId={workspaceId} />
      )}
    </section>
  );
}

// ============================================================================
// Cost APIFY
// ============================================================================

function CostSection({ workspaceId }: { workspaceId?: string }) {
  const [rows, setRows] = useState<ApifyRunAggregate[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        let q = supabase
          .from("apify_runs")
          .select("user_id, cost_usd, cached, ran_at")
          .gte("ran_at", monthStart.toISOString());
        if (workspaceId) q = q.eq("workspace_id", workspaceId);
        const { data, error } = await q;
        if (error) throw error;
        // aggregate por user_id
        const map = new Map<string, ApifyRunAggregate>();
        for (const r of data ?? []) {
          const ru = r as {
            user_id: string;
            cost_usd: number | null;
            cached: boolean;
            ran_at: string;
          };
          const isToday = new Date(ru.ran_at) >= todayStart;
          const cur =
            map.get(ru.user_id) ??
            ({
              user_email: ru.user_id,
              runs_month: 0,
              runs_cached_month: 0,
              cost_month: 0,
              runs_today: 0,
              cost_today: 0,
            } as ApifyRunAggregate);
          cur.runs_month += 1;
          if (ru.cached) cur.runs_cached_month += 1;
          cur.cost_month += ru.cost_usd ?? 0;
          if (isToday) {
            cur.runs_today += 1;
            cur.cost_today += ru.cost_usd ?? 0;
          }
          map.set(ru.user_id, cur);
        }
        if (!cancelled) setRows([...map.values()].sort((a, b) => b.cost_month - a.cost_month));
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const totals = useMemo(() => {
    if (!rows) return null;
    return rows.reduce(
      (acc, r) => ({
        runs_month: acc.runs_month + r.runs_month,
        runs_cached_month: acc.runs_cached_month + r.runs_cached_month,
        cost_month: acc.cost_month + r.cost_month,
        runs_today: acc.runs_today + r.runs_today,
        cost_today: acc.cost_today + r.cost_today,
      }),
      {
        runs_month: 0,
        runs_cached_month: 0,
        cost_month: 0,
        runs_today: 0,
        cost_today: 0,
      }
    );
  }, [rows]);

  if (err) {
    return (
      <div
        role="alert"
        class="rounded border border-red-800/60 bg-red-950/30 px-3 py-2 text-xs text-red-200"
      >
        erro carregando custo: {err}
      </div>
    );
  }
  if (!rows) {
    return <SkeletonSection />;
  }
  if (rows.length === 0) {
    return (
      <div class="rounded border border-zinc-800 bg-zinc-900/40 px-3 py-4 text-center">
        <p class="text-xs text-zinc-400">
          nenhum run APIFY neste mes ainda.
        </p>
        <p class="mt-0.5 text-[10px] text-zinc-500">
          cache-hits e miss aparecem aqui apos o primeiro refresh LinkedIn.
        </p>
      </div>
    );
  }

  const overAlert = Boolean(
    totals && totals.cost_month > APIFY.MONTHLY_ALERT_USD
  );
  const cacheRate =
    totals && totals.runs_month > 0
      ? Math.round((totals.runs_cached_month / totals.runs_month) * 100)
      : 0;

  return (
    <div class="space-y-2.5">
      {/* Big number: mes atual */}
      <div
        class={`grid grid-cols-3 gap-0.5 rounded border ${
          overAlert ? "border-red-900/60" : "border-zinc-800"
        } bg-zinc-900/40 p-2`}
      >
        <BigStat
          label="mes atual"
          value={formatUsd(totals?.cost_month ?? 0)}
          warning={overAlert}
          alertLabel={
            overAlert ? `> alerta ${formatUsd(APIFY.MONTHLY_ALERT_USD)}` : undefined
          }
        />
        <BigStat
          label="hoje"
          value={formatUsd(totals?.cost_today ?? 0)}
        />
        <BigStat
          label="reaproveitado"
          value={`${cacheRate}%`}
          hint={`${totals?.runs_cached_month ?? 0}/${totals?.runs_month ?? 0}`}
        />
      </div>

      {/* Breakdown por user */}
      <div class="rounded border border-zinc-800 bg-zinc-900/40">
        <div class="grid grid-cols-[1fr_60px_60px_60px] gap-2 border-b border-zinc-800 px-2.5 py-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-zinc-500">
          <div>analista</div>
          <div class="text-right">runs</div>
          <div class="text-right">cache</div>
          <div class="text-right">$ mes</div>
        </div>
        <ul>
          {rows.map((r) => (
            <li
              key={r.user_email}
              class="grid grid-cols-[1fr_60px_60px_60px] gap-2 border-b border-zinc-800/50 px-2.5 py-1.5 text-[11px] last:border-0"
            >
              <span class="truncate text-zinc-300" title={r.user_email}>
                {shortenEmail(r.user_email)}
              </span>
              <span class="text-right font-mono tabular-nums text-zinc-400">
                {r.runs_month}
              </span>
              <span class="text-right font-mono tabular-nums text-zinc-500">
                {r.runs_cached_month}
              </span>
              <span class="text-right font-mono tabular-nums text-zinc-200">
                {formatUsd(r.cost_month)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ============================================================================
// Impact map
// ============================================================================

function ImpactSection({ workspaceId }: { workspaceId?: string }) {
  const [rows, setRows] = useState<ImpactStat[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        let q = supabase
          .from("linkedin_replies")
          .select("poi_target_id, poi_target_name, bridge_id, decision")
          .eq("decision", "posted")
          .gte("posted_at", monthStart.toISOString());
        if (workspaceId) q = q.eq("workspace_id", workspaceId);
        const { data, error } = await q;
        if (error) throw error;

        const byPoi = new Map<
          string,
          { name: string; touches: number; bridges: Set<string> }
        >();
        for (const r of data ?? []) {
          const row = r as {
            poi_target_id: string | null;
            poi_target_name: string | null;
            bridge_id: string | null;
          };
          if (!row.poi_target_id) continue;
          const cur =
            byPoi.get(row.poi_target_id) ??
            ({
              name: row.poi_target_name ?? row.poi_target_id,
              touches: 0,
              bridges: new Set<string>(),
            } as { name: string; touches: number; bridges: Set<string> });
          cur.touches += 1;
          if (row.bridge_id) cur.bridges.add(row.bridge_id);
          byPoi.set(row.poi_target_id, cur);
        }
        const result: ImpactStat[] = [...byPoi.entries()]
          .map(([id, v]) => ({
            poi_id: id,
            poi_name: v.name,
            touches_month: v.touches,
            bridges_used: v.bridges.size,
            posted_replies: v.touches,
          }))
          .sort((a, b) => b.touches_month - a.touches_month);
        if (!cancelled) setRows(result);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  if (err) {
    return (
      <div
        role="alert"
        class="rounded border border-red-800/60 bg-red-950/30 px-3 py-2 text-xs text-red-200"
      >
        erro carregando impact map: {err}
      </div>
    );
  }
  if (!rows) return <SkeletonSection />;
  if (rows.length === 0) {
    return (
      <div class="rounded border border-zinc-800 bg-zinc-900/40 px-3 py-4 text-center">
        <p class="text-xs text-zinc-400">
          nenhuma pessoa-alvo impactada neste mes.
        </p>
        <p class="mt-0.5 text-[10px] leading-snug text-zinc-500">
          o mapa de impacto aparece quando analistas postam replies via conexoes com pessoa-alvo definida.
        </p>
      </div>
    );
  }

  const totals = {
    unique_pois: rows.length,
    total_touches: rows.reduce((s, r) => s + r.touches_month, 0),
    avg_bridges_per_poi: (
      rows.reduce((s, r) => s + r.bridges_used, 0) / rows.length
    ).toFixed(1),
  };

  return (
    <div class="space-y-2.5">
      <div class="grid grid-cols-3 gap-0.5 rounded border border-zinc-800 bg-zinc-900/40 p-2">
        <BigStat label="pessoas-alvo no mes" value={String(totals.unique_pois)} />
        <BigStat label="toques" value={String(totals.total_touches)} />
        <BigStat
          label="conexoes / pessoa"
          value={totals.avg_bridges_per_poi}
        />
      </div>

      <div class="rounded border border-zinc-800 bg-zinc-900/40">
        <div class="grid grid-cols-[1fr_60px_60px] gap-2 border-b border-zinc-800 px-2.5 py-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-zinc-500">
          <div>pessoa-alvo</div>
          <div class="text-right">toques</div>
          <div class="text-right">conexoes</div>
        </div>
        <ul>
          {rows.slice(0, 20).map((r) => (
            <li
              key={r.poi_id}
              class="grid grid-cols-[1fr_60px_60px] gap-2 border-b border-zinc-800/50 px-2.5 py-1.5 text-[11px] last:border-0"
            >
              <span class="truncate text-zinc-200" title={r.poi_name}>
                {r.poi_name}
              </span>
              <span class="text-right font-mono tabular-nums text-zinc-100">
                {r.touches_month}
              </span>
              <span class="text-right font-mono tabular-nums text-zinc-500">
                {r.bridges_used}
              </span>
            </li>
          ))}
        </ul>
        {rows.length > 20 && (
          <div class="border-t border-zinc-800 px-2.5 py-1 text-center text-[9.5px] text-zinc-500">
            +{rows.length - 20} POIs abaixo do top 20
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Building blocks
// ============================================================================

function BigStat({
  label,
  value,
  hint,
  warning = false,
  alertLabel,
}: {
  label: string;
  value: string;
  hint?: string;
  warning?: boolean;
  alertLabel?: string;
}) {
  return (
    <div class="flex flex-col items-start px-2 py-1">
      <span class="text-[9.5px] uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <span
        class={`font-mono text-lg tabular-nums leading-tight ${
          warning ? "text-red-400" : "text-zinc-100"
        }`}
      >
        {value}
      </span>
      {hint && (
        <span class="text-[9.5px] font-mono tabular-nums text-zinc-500">
          {hint}
        </span>
      )}
      {alertLabel && (
        <span class="text-[9.5px] text-red-400">{alertLabel}</span>
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
  controls,
}: {
  active: boolean;
  onClick: () => void;
  children: preact.ComponentChildren;
  controls: string;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      onClick={onClick}
      class={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-inset ${
        active
          ? "bg-sky-600 text-white"
          : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

function SkeletonSection() {
  return (
    <div class="space-y-2.5" aria-busy="true">
      <div class="h-16 animate-pulse rounded border border-zinc-800 bg-zinc-900/40" />
      <div class="h-40 animate-pulse rounded border border-zinc-800 bg-zinc-900/40" />
    </div>
  );
}

// ---- helpers ----

function formatUsd(v: number): string {
  return "$" + v.toFixed(2);
}

function shortenEmail(email: string): string {
  if (email.length < 26) return email;
  const at = email.indexOf("@");
  if (at < 0) return email.slice(0, 24) + "…";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length > 14) return local.slice(0, 12) + "…" + domain;
  return email;
}
