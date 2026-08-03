// V5.1 — Sumario de custo APIFY por workspace.
//
// Usado em:
//   - LinkedInView (chip visivel no TriageSummary — user ve gasto antes de rodar)
//   - LinkedInAdminPanel (breakdown detalhado)
//
// Query direto em apify_runs — leve, sem cache.

import { supabase } from "../../supabase";
import { APIFY } from "../../constants";

export interface ApifyCostSummary {
  cost_today: number;
  cost_month: number;
  runs_today: number;
  runs_month: number;
  runs_cached_month: number;
}

const EMPTY: ApifyCostSummary = {
  cost_today: 0,
  cost_month: 0,
  runs_today: 0,
  runs_month: 0,
  runs_cached_month: 0,
};

export async function getApifyCostSummary(
  workspaceId: string
): Promise<ApifyCostSummary> {
  try {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("apify_runs")
      .select("actor_id, cost_usd, cached, items_returned, ran_at")
      .eq("workspace_id", workspaceId)
      .gte("ran_at", monthStart.toISOString());
    if (error) return EMPTY;

    const summary = { ...EMPTY };
    for (const r of data ?? []) {
      const row = r as {
        actor_id: string;
        cost_usd: number | null;
        cached: boolean;
        items_returned: number | null;
        ran_at: string;
      };
      const isToday = new Date(row.ran_at) >= todayStart;
      const cost = row.cached
        ? 0
        : row.actor_id === APIFY.LINKEDIN_POSTS_ACTOR
          ? (row.items_returned ?? 0) * APIFY.LINKEDIN_POST_USD
          : row.cost_usd ?? 0;
      summary.runs_month += 1;
      summary.cost_month += cost;
      if (row.cached) summary.runs_cached_month += 1;
      if (isToday) {
        summary.runs_today += 1;
        summary.cost_today += cost;
      }
    }
    return summary;
  } catch {
    return EMPTY;
  }
}

export function formatCostUsd(cost: number): string {
  if (cost === 0) return "$0";
  if (cost < 0.01) return "<$0.01";
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}
