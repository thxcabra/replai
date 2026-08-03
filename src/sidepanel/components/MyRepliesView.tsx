import { useEffect, useState } from "preact/hooks";
import {
  pullMyReplies,
  updateReplyMetrics,
  type MyReplyFilters,
  type ReplyMetricsUpdate,
} from "../../lib/sync";
import type { ReplyLogRow } from "../../lib/supabase-types";
import { Button } from "../ui/Button";

interface Props {
  workspaceId: string | null;
  workspaceName: string | null;
  onClose: () => void;
  profile?: import("../../lib/supabase-types").ProfileRow | null;
  // V4.1.5: suprime header proprio quando renderizado dentro do HistoricoView
  embedded?: boolean;
}

type FilterScope = "current_workspace" | "all_workspaces";
type FilterDecision = "all" | "posted" | "skipped" | "ignored";

// V4.1.2 — "meus replies": lista das replies do analista logado com
// possibilidade de editar metricas manuais (likes/RTs/quotes/etc) sem
// scraping. Source of truth = reply_logs. RLS garante so as proprias.
export function MyRepliesView({
  workspaceId,
  workspaceName,
  onClose,
  embedded = false,
}: Props) {
  const [rows, setRows] = useState<ReplyLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<FilterScope>("current_workspace");
  const [decision, setDecision] = useState<FilterDecision>("all");
  const [hasUrl, setHasUrl] = useState<"any" | "yes" | "no">("any");
  const [authorSearch, setAuthorSearch] = useState("");
  const [sinceDays, setSinceDays] = useState(30);

  // V4.1.14 (WR-14): load aceita isCancelled() pra evitar setState
  // depois de mudanca de filtro mid-flight.
  async function load(isCancelled?: () => boolean) {
    setLoading(true);
    setError(null);
    try {
      const filters: MyReplyFilters = {
        workspaceId: scope === "current_workspace" ? workspaceId : null,
        decision: decision === "all" ? null : decision,
        hasUrl: hasUrl === "any" ? undefined : hasUrl === "yes",
        authorHandle: authorSearch.trim() || undefined,
        sinceDays,
        limit: 200,
      };
      const data = await pullMyReplies(filters);
      if (!isCancelled?.()) setRows(data);
    } catch (e) {
      if (!isCancelled?.())
        setError((e as Error).message ?? "erro carregando replies");
    } finally {
      if (!isCancelled?.()) setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, decision, hasUrl, sinceDays]);

  function applyAuthorFilter() {
    load();
  }

  async function handleSaveMetrics(
    replyLogId: string,
    updates: ReplyMetricsUpdate
  ) {
    try {
      const updated = await updateReplyMetrics(replyLogId, updates);
      setRows((prev) => prev.map((r) => (r.id === replyLogId ? updated : r)));
    } catch (e) {
      setError(`erro salvando metricas: ${(e as Error).message ?? e}`);
    }
  }

  return (
    <div class="flex flex-col gap-3 p-3">
      {/* HEADER — suprimido quando embedded (HistoricoView ja tem seu) */}
      {!embedded && (
        <div class="flex items-center justify-between gap-2">
          <div>
            <h2 class="text-base font-bold text-zinc-100">meus replies</h2>
            <p class="text-[11px] text-zinc-500">
              replies que voce ja postou — adicione metricas reais
              (likes/RTs/etc) ou marque se OP respondeu.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            fechar
          </Button>
        </div>
      )}
      {embedded && (
        <p class="text-[11px] text-zinc-500">
          adicione metricas reais (likes/RTs/etc) ou marque se OP respondeu.
        </p>
      )}

      {/* FILTROS */}
      <div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
        <div class="grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <label class="mb-0.5 block text-zinc-400">workspace</label>
            <select
              class="w-full rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-zinc-200"
              value={scope}
              onChange={(e) =>
                setScope(
                  (e.target as HTMLSelectElement).value as FilterScope
                )
              }
            >
              <option value="current_workspace">
                so {workspaceName ?? "atual"}
              </option>
              <option value="all_workspaces">todos os workspaces</option>
            </select>
          </div>
          <div>
            <label class="mb-0.5 block text-zinc-400">decisao</label>
            <select
              class="w-full rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-zinc-200"
              value={decision}
              onChange={(e) =>
                setDecision(
                  (e.target as HTMLSelectElement).value as FilterDecision
                )
              }
            >
              <option value="all">todas</option>
              <option value="posted">postadas</option>
              <option value="skipped">descartadas</option>
              <option value="ignored">ignoradas</option>
            </select>
          </div>
          <div>
            <label class="mb-0.5 block text-zinc-400">tem URL postada</label>
            <select
              class="w-full rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-zinc-200"
              value={hasUrl}
              onChange={(e) =>
                setHasUrl(
                  (e.target as HTMLSelectElement).value as
                    | "any"
                    | "yes"
                    | "no"
                )
              }
            >
              <option value="any">qualquer</option>
              <option value="yes">so verificadas (com URL)</option>
              <option value="no">sem URL</option>
            </select>
          </div>
          <div>
            <label class="mb-0.5 block text-zinc-400">ultimos dias</label>
            <input
              type="number"
              min={1}
              max={365}
              class="w-full rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-zinc-200"
              value={sinceDays}
              onInput={(e) =>
                setSinceDays(
                  Math.max(
                    1,
                    Math.min(
                      365,
                      Number((e.target as HTMLInputElement).value) || 30
                    )
                  )
                )
              }
            />
          </div>
        </div>
        <div class="mt-2 flex gap-1.5">
          <input
            type="text"
            class="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200"
            placeholder="filtrar por handle do autor (ex: naval)"
            value={authorSearch}
            onInput={(e) =>
              setAuthorSearch((e.target as HTMLInputElement).value)
            }
            onKeyDown={(e) => {
              if ((e as KeyboardEvent).key === "Enter") applyAuthorFilter();
            }}
          />
          <Button variant="ghost" size="sm" onClick={applyAuthorFilter}>
            buscar
          </Button>
        </div>
      </div>

      {/* STATUS */}
      {error && (
        <div class="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
      {loading && (
        <div class="rounded border border-zinc-800 bg-zinc-900/50 p-4 text-center text-sm text-zinc-400">
          carregando...
        </div>
      )}
      {!loading && rows.length === 0 && !error && (
        <div class="rounded border border-zinc-800 bg-zinc-900/50 p-4 text-center text-sm text-zinc-400">
          nenhuma reply encontrada com esses filtros.
        </div>
      )}

      {/* LISTA */}
      {!loading &&
        rows.map((r) => (
          <ReplyRow key={r.id} row={r} onSave={handleSaveMetrics} />
        ))}
    </div>
  );
}

// ---- Card individual de reply (inline edit) ----

function ReplyRow({
  row,
  onSave,
}: {
  row: ReplyLogRow;
  onSave: (id: string, updates: ReplyMetricsUpdate) => Promise<void>;
}) {
  const [actualLikes, setActualLikes] = useState<string>(
    row.actual_likes != null ? String(row.actual_likes) : ""
  );
  const [actualRetweets, setActualRetweets] = useState<string>(
    row.actual_retweets != null ? String(row.actual_retweets) : ""
  );
  const [actualReplies, setActualReplies] = useState<string>(
    row.actual_replies != null ? String(row.actual_replies) : ""
  );
  const [actualQuotes, setActualQuotes] = useState<string>(
    row.actual_quotes != null ? String(row.actual_quotes) : ""
  );
  const [opReplied, setOpReplied] = useState<boolean>(
    row.op_replied_back ?? false
  );
  const [opEngaged, setOpEngaged] = useState<boolean>(
    row.author_engaged_at_post ?? false
  );
  const [notes, setNotes] = useState<string>(row.analyst_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const decisionColor =
    row.decision === "posted"
      ? "text-emerald-300"
      : row.decision === "skipped"
        ? "text-zinc-500"
        : "text-zinc-400";

  function parseNumOrNull(v: string): number | null {
    const trimmed = v.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(row.id, {
        actual_likes: parseNumOrNull(actualLikes),
        actual_retweets: parseNumOrNull(actualRetweets),
        actual_replies: parseNumOrNull(actualReplies),
        actual_quotes: parseNumOrNull(actualQuotes),
        op_replied_back: opReplied,
        author_engaged_at_post: opEngaged,
        analyst_notes: notes.trim() || null,
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  const postedUrl = row.posted_reply_id
    ? `https://x.com/${row.tweet_handle ?? "i"}/status/${row.posted_reply_id}`
    : null;

  return (
    <article class="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
      {/* HEADER: handle + decisao + data */}
      <div class="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
        <div class="flex items-center gap-1.5">
          {row.tweet_handle && (
            <a
              href={`https://x.com/${row.tweet_handle}`}
              target="_blank"
              rel="noreferrer"
              class="font-semibold text-sky-300 hover:underline"
            >
              @{row.tweet_handle}
            </a>
          )}
          <span class={decisionColor}>
            {row.decision === "posted"
              ? "postada"
              : row.decision === "skipped"
                ? "descartada"
                : row.decision === "ignored"
                  ? "ignorada"
                  : row.decision ?? "—"}
          </span>
          {row.decision_type === "quote_tweet" && (
            <span class="rounded bg-violet-500/15 px-1 py-0.5 text-[10px] text-violet-300">
              QT
            </span>
          )}
          {row.posted_reply_id && (
            <span class="rounded bg-emerald-500/15 px-1 py-0.5 text-[10px] text-emerald-300">
              verificada
            </span>
          )}
          {row.author_tier && (
            <span class="rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-400">
              {row.author_tier}
            </span>
          )}
        </div>
        <div class="text-zinc-500">
          {new Date(row.logged_at).toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "short",
          })}
        </div>
      </div>

      {/* TWEET ORIGINAL (compact) */}
      {row.tweet_text && (
        <div class="mb-1.5 rounded border border-zinc-800 bg-zinc-950 p-1.5">
          <div class="mb-0.5 text-[10px] uppercase text-zinc-500">tweet</div>
          <p class="line-clamp-2 text-[11px] text-zinc-400">{row.tweet_text}</p>
        </div>
      )}

      {/* REPLY TEXT */}
      <div class="mb-2 rounded bg-zinc-800/40 p-1.5">
        <div class="mb-0.5 text-[10px] uppercase text-zinc-500">
          sua reply{row.was_edited ? " (editada)" : ""}
        </div>
        <p class="whitespace-pre-wrap text-[12px] text-zinc-100">
          {row.reply_text}
        </p>
        {postedUrl && (
          <a
            href={postedUrl}
            target="_blank"
            rel="noreferrer"
            class="mt-1 inline-block text-[10px] text-sky-400 hover:underline"
          >
            ↗ abrir no X
          </a>
        )}
      </div>

      {/* SCORES + ENGAGEMENT EDITOR */}
      <details class="rounded border border-zinc-800 bg-zinc-950">
        <summary class="cursor-pointer px-2 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200">
          <span aria-hidden="true">▸</span> metricas + notas
          {(row.actual_likes != null ||
            row.actual_retweets != null ||
            row.op_replied_back === true) && (
            <span class="ml-1 rounded bg-emerald-500/15 px-1 py-0.5 text-[10px] text-emerald-300">
              preenchido
            </span>
          )}
        </summary>
        <div class="border-t border-zinc-800 p-2">
          <div class="grid grid-cols-4 gap-1.5">
            <NumberField
              label="❤️ likes"
              value={actualLikes}
              onChange={setActualLikes}
            />
            <NumberField
              label="↺ RTs"
              value={actualRetweets}
              onChange={setActualRetweets}
            />
            <NumberField
              label="💬 replies"
              value={actualReplies}
              onChange={setActualReplies}
            />
            <NumberField
              label="📤 quotes"
              value={actualQuotes}
              onChange={setActualQuotes}
            />
          </div>
          <div class="mt-2 flex flex-wrap gap-3 text-[11px]">
            <label class="flex items-center gap-1.5 text-zinc-200">
              <input
                type="checkbox"
                checked={opReplied}
                onChange={(e) =>
                  setOpReplied((e.target as HTMLInputElement).checked)
                }
              />
              OP respondeu de volta
            </label>
            <label class="flex items-center gap-1.5 text-zinc-200">
              <input
                type="checkbox"
                checked={opEngaged}
                onChange={(e) =>
                  setOpEngaged((e.target as HTMLInputElement).checked)
                }
              />
              OP engajou (like/follow/etc)
            </label>
          </div>
          <textarea
            class="mt-2 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200"
            placeholder="notas livres (ex: virou DM, ganhou follow, OP me adicionou de amigo...)"
            rows={2}
            value={notes}
            onInput={(e) =>
              setNotes((e.target as HTMLTextAreaElement).value)
            }
          />
          {/* score info (read-only) */}
          {(row.persona_relevance != null ||
            row.engagement_potential != null) && (
            <div class="mt-2 flex flex-wrap gap-2 text-[10px] text-zinc-500">
              {row.persona_relevance != null && (
                <span>voz: {row.persona_relevance}</span>
              )}
              {row.engagement_potential != null && (
                <span>eng esperado: {row.engagement_potential}</span>
              )}
              {row.selection_combined != null && (
                <span>combined: {row.selection_combined}</span>
              )}
              {row.reply_category && (
                <span>categoria: {row.reply_category}</span>
              )}
            </div>
          )}
          <div class="mt-2 flex items-center justify-between gap-2">
            <span class="text-[10px] text-zinc-500">
              {row.metrics_updated_at
                ? `salvo ha ${timeAgo(row.metrics_updated_at)}`
                : "nunca salvo"}
            </span>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "..." : savedFlash ? "salvo ✓" : "salvar metricas"}
            </Button>
          </div>
        </div>
      </details>
    </article>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label class="mb-0.5 block text-[10px] text-zinc-500">{label}</label>
      <input
        type="number"
        min={0}
        class="w-full rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-[11px] text-zinc-200"
        value={value}
        placeholder="—"
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
      />
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
