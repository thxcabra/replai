// V5 — Card de post LinkedIn na triage.
//
// UX principios aplicados:
// - Hierarquia clara: bridge (autor) â†’ post content â†’ contexto Groundswell (POI, relation, topics)
// - Meta chips com semantica visual (readiness=cor, relation_type=texto, POI=destaque)
// - Truncation-strategy: text preview + "ver mais" (evita cards gigantes)
// - Tabular-nums nos scores
// - Selection state visivel (checkbox)
// - Focus visible em toda interacao

import { useState } from "preact/hooks";
import type {
  GroundswellBridge,
  PoiCandidate,
  RawPost,
} from "../../../lib/channels/types";

interface Props {
  post: RawPost;
  bridge?: GroundswellBridge;
  suggestedPoi?: PoiCandidate;
  selected?: boolean;
  onToggleSelect?: (selected: boolean) => void;
  onOpen?: () => void;
}

// V5.3.2: exporter novo introduziu `promising` (~emerging) e `not_yet` (~needs_work).
// Ambos vocabularios mapeiam pras mesmas 3 cores.
const READINESS_COLOR: Record<string, { border: string; badge: string; text: string }> = {
  ready: {
    border: "border-emerald-700",
    badge: "bg-emerald-950/70 border-emerald-700",
    text: "text-emerald-300",
  },
  emerging: {
    border: "border-amber-700",
    badge: "bg-amber-950/60 border-amber-700",
    text: "text-amber-300",
  },
  promising: {
    border: "border-amber-700",
    badge: "bg-amber-950/60 border-amber-700",
    text: "text-amber-300",
  },
  needs_work: {
    border: "border-zinc-700",
    badge: "bg-zinc-800/60 border-zinc-700",
    text: "text-zinc-400",
  },
  not_yet: {
    border: "border-zinc-700",
    badge: "bg-zinc-800/60 border-zinc-700",
    text: "text-zinc-400",
  },
};

// V5.2: 8 tiers reduzidos a 4 buckets (feedback: overload informacional).
// Sinal preservado (recip > freq > ocasional > raro) mas legivel a olho.
const RELATION_TIER_LABEL: Record<string, string> = {
  reciprocal_pair: "reciproco",
  inner_circle: "frequente",
  frequent_contact: "frequente",
  peer: "frequente",
  occasional_contact: "ocasional",
  sporadic_contact: "ocasional",
  episodic_contact: "raro",
  one_off: "raro",
};

export function LinkedInPostCard({
  post,
  bridge,
  suggestedPoi,
  selected = false,
  onToggleSelect,
  onOpen,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const tier = bridge?.readiness_tier ?? "needs_work";
  const styles = READINESS_COLOR[tier] ?? READINESS_COLOR.needs_work;
  const previewLen = 220;
  const needsExpand = post.text.length > previewLen;
  const displayText =
    !needsExpand || expanded ? post.text : post.text.slice(0, previewLen) + "…";

  return (
    <article
      class={`rounded border ${styles.border} bg-zinc-900/70 transition-colors ${
        selected ? "ring-2 ring-sky-500 ring-offset-1 ring-offset-zinc-950" : ""
      }`}
      aria-labelledby={`post-${post.post_ref}-author`}
    >
      {/* Header: avatar + Bridge (autor) + Selection.
          V5.2: hierarchy avatar+name-first. Readiness_tier moveu pro footer
          pra reduzir peso visual — o autor e o post viram foco. */}
      <header class="flex items-start gap-2 border-b border-zinc-700 px-2.5 py-2">
        {onToggleSelect && (
          <label class="mt-0.5 flex shrink-0 cursor-pointer items-center">
            <span class="sr-only">selecionar post</span>
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) =>
                onToggleSelect((e.target as HTMLInputElement).checked)
              }
              class="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-zinc-600 bg-zinc-900 text-sky-600 focus:ring-2 focus:ring-sky-500 focus:ring-offset-1 focus:ring-offset-zinc-950"
            />
          </label>
        )}
        {post.author_avatar_url ? (
          <img
            src={post.author_avatar_url}
            alt=""
            loading="lazy"
            class="mt-0.5 h-9 w-9 shrink-0 rounded-full border border-zinc-800 object-cover"
          />
        ) : (
          <div
            class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-800 text-[11px] font-semibold text-zinc-400"
            aria-hidden="true"
          >
            {(post.author_display_name || post.author_handle || "?").slice(0, 1).toUpperCase()}
          </div>
        )}
        <div class="min-w-0 flex-1">
          <span
            id={`post-${post.post_ref}-author`}
            class="block truncate text-[13px] font-semibold text-zinc-100"
          >
            {post.author_display_name || post.author_handle || "—"}
          </span>
          {post.author_headline && (
            <div class="mt-0.5 truncate text-[11px] text-zinc-400">
              {post.author_headline}
            </div>
          )}
        </div>
      </header>

      {/* Post content */}
      <div class="px-2.5 py-2">
        {/* V5.3.2: tags do tipo de post — user pediu manter reposts/quotes/etc
            no feed com sinal visual claro em vez de filtrar. */}
        <PostTypeTags post={post} />
        <p
          class="whitespace-pre-wrap text-[12.5px] leading-relaxed text-zinc-200"
          style="overflow-wrap: anywhere"
        >
          {displayText}
        </p>
        {needsExpand && (
          <button
            onClick={() => setExpanded((v) => !v)}
            class="mt-1 text-[11px] font-medium text-sky-400 underline underline-offset-2 hover:text-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-1 focus:ring-offset-zinc-900"
          >
            {expanded ? "ver menos" : "ver mais"}
          </button>
        )}

        {/* Engagement metrics */}
        {(post.engagement.reactions ||
          post.engagement.comments ||
          post.engagement.reshares) && (
          <div class="mt-2 flex gap-3 font-mono text-[11px] tabular-nums text-zinc-400">
            {post.engagement.reactions !== undefined && (
              <span>
                <span aria-hidden="true">â™¥</span>{" "}
                {formatCompact(post.engagement.reactions)}
              </span>
            )}
            {post.engagement.comments !== undefined && (
              <span>
                <span aria-hidden="true">ðŸ’¬</span>{" "}
                {formatCompact(post.engagement.comments)}
              </span>
            )}
            {post.engagement.reshares !== undefined && (
              <span>
                <span aria-hidden="true">↻</span>{" "}
                {formatCompact(post.engagement.reshares)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Contexto Groundswell — pessoa-alvo sugerida (V5.2: rename POI-target). */}
      {suggestedPoi && (
        <div class="border-t border-zinc-700 bg-zinc-950/40 px-2.5 py-1.5">
          <div class="mb-1 flex items-baseline justify-between">
            <span class="text-[11px] font-semibold uppercase tracking-wide text-sky-300">
              pessoa-alvo sugerida
            </span>
            <span class="font-mono text-[11px] tabular-nums text-zinc-400">
              score{" "}
              <span class="text-sky-300">
                {suggestedPoi.composite_score.toFixed(2)}
              </span>
            </span>
          </div>
          <div class="flex items-baseline justify-between gap-2">
            <span class="min-w-0 truncate text-xs font-medium text-zinc-100">
              {suggestedPoi.poi_name}
            </span>
            <span class="shrink-0 rounded border border-sky-800/60 bg-sky-950/40 px-1.5 py-0.5 text-[11px] text-sky-300">
              {RELATION_TIER_LABEL[suggestedPoi.relation_type] ??
                suggestedPoi.relation_type}
            </span>
          </div>
          {suggestedPoi.reciprocity && (
            <div class="mt-0.5 text-[11px] text-emerald-400">
              âœ“ POI ja engajou de volta com esta bridge
            </div>
          )}
        </div>
      )}

      {/* Footer actions — V5.2: readiness_tier chip aqui em vez do header. */}
      <footer class="flex items-center justify-between gap-2 border-t border-zinc-700 px-2.5 py-1.5">
        <div class="flex items-center gap-1.5">
          <span class="font-mono text-[11px] tabular-nums text-zinc-400">
            {formatRelative(post.created_at)}
          </span>
          {/* V5.3.2: badge readiness_tier removido — feedback "muita info".
              Sinal ainda existe via cor da border do card. */}
        </div>
        <div class="flex items-center gap-1.5">
          {post.url && (
            <a
              href={post.url}
              target="_blank"
              rel="noreferrer noopener"
              class="rounded border border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-1 focus:ring-offset-zinc-900"
              title="abrir no LinkedIn"
            >
              abrir
            </a>
          )}
          {onOpen && (
            <button
              onClick={onOpen}
              class="rounded bg-sky-600 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-1 focus:ring-offset-zinc-900"
            >
              gerar reply
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}

// ============================================================================
// Helpers
// ============================================================================

// V5.3.2: badges do tipo de post — reposts, quotes, articles, jobs, sem texto.
// Sinaliza pro user antes que ele leia o card — evita clicar em post do tipo
// "errado" pra reply (ex: repost sem contexto de discussao). Config: cada tipo
// tem cor propria pra scanning rapido.
function PostTypeTags({ post }: { post: RawPost }) {
  const tags: Array<{ label: string; cls: string; title: string }> = [];
  const t = post.post_type;
  if (t === "repost") {
    tags.push({
      label: "repost",
      cls: "bg-zinc-800 text-zinc-400 border-zinc-700",
      title: "Compartilhamento sem comentario. Reply cai como resposta ao autor original que a bridge compartilhou.",
    });
  } else if (t === "quote") {
    tags.push({
      label: "share com comentario",
      cls: "bg-sky-500/15 text-sky-300 border-sky-700/40",
      title: "Bridge compartilhou algo e adicionou comentario proprio. Bom pra reply — tem opiniao pra dialogar.",
    });
  } else if (t === "article") {
    tags.push({
      label: "artigo",
      cls: "bg-indigo-500/15 text-indigo-300 border-indigo-700/40",
      title: "LinkedIn Article (formato longform). Reply idealmente engaja com uma tese especifica.",
    });
  } else if (t === "job") {
    tags.push({
      label: "vaga",
      cls: "bg-emerald-500/15 text-emerald-300 border-emerald-700/40",
      title: "Post de vaga de emprego. Reply so se fizer sentido (indicar alguem, etc).",
    });
  }
  if (!post.text || post.text.trim().length < 20) {
    tags.push({
      label: "sem texto util",
      cls: "bg-amber-500/15 text-amber-300 border-amber-700/40",
      title: "Post sem texto substancial (so imagem/link/video). LLM tem pouco contexto pra reply — pode sair generico.",
    });
  }
  if (tags.length === 0) return null;
  return (
    <div class="mb-1.5 flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag.label}
          title={tag.title}
          class={`rounded border px-1.5 py-[1px] text-[11px] uppercase tracking-wide ${tag.cls}`}
        >
          {tag.label}
        </span>
      ))}
    </div>
  );
}

function formatCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}


