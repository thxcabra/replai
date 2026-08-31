// V5 — Reply card LinkedIn.
//
// UX principios:
// - Rate limit feedback nao intrusivo: badge com cooldown countdown; nao bloqueia leitura
// - POI target dropdown com heuristica score (nao subestima o analista, mas destaca sugerido)
// - Clipboard action com confirmacao visual (success-feedback â‰¤300ms)
// - Char count com tabular-nums + estado warning proximo do limite
// - Focus visible em tudo interativo

import { useEffect, useState } from "preact/hooks";
import { LIMITS } from "../../../lib/constants";
import { safeOpenUrl } from "../../../lib/safe-url";
import {
  checkCanGenerate,
  formatWait,
  recordGeneration,
  recordPost,
} from "../../../lib/channels/linkedin/rate-limiter";
import type {
  PoiCandidate,
  RawPost,
} from "../../../lib/channels/types";

interface Props {
  post: RawPost;
  replyText: string;
  onReplyChange: (text: string) => void;
  poiCandidates: PoiCandidate[];
  selectedPoiId?: string;
  onPoiSelect: (poiId: string) => void;
  onRegenerate?: () => void | Promise<void>;
  onPost: () => void | Promise<void>;
  onSkip?: () => void;
  strategyNote?: string;
  isGenerating?: boolean;
  dailyLimitConfig?: number;
}

interface RateStatus {
  allowed: boolean;
  reason?: "hourly_cap" | "cooldown" | "daily_cap" | "off_hours";
  waitMs?: number;
  remainingHour?: number;
  remainingDay?: number;
}

export function LinkedInReplyCard({
  post,
  replyText,
  onReplyChange,
  poiCandidates,
  selectedPoiId,
  onPoiSelect,
  onRegenerate,
  onPost,
  onSkip,
  strategyNote,
  isGenerating = false,
  dailyLimitConfig,
}: Props) {
  const [rateStatus, setRateStatus] = useState<RateStatus | null>(null);
  const [copiedFlash, setCopiedFlash] = useState(false);
  const [postingBusy, setPostingBusy] = useState(false);

  // Consulta rate limiter na montagem + a cada 10s (cooldown countdown)
  useEffect(() => {
    let mounted = true;
    async function refresh() {
      const s = await checkCanGenerate(dailyLimitConfig);
      if (!mounted) return;
      setRateStatus({
        allowed: s.allowed,
        reason: s.reason,
        waitMs: s.wait_ms,
        remainingHour: s.remaining_generations_hour,
        remainingDay: s.remaining_posts_day,
      });
    }
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [dailyLimitConfig]);

  const charCount = replyText.length;
  const charLimit = LIMITS.LINKEDIN_COMMENT_CHAR_LIMIT;
  const overLimit = charCount > charLimit;
  const nearLimit = charCount > charLimit * 0.9 && !overLimit;

  const selectedPoi = poiCandidates.find((p) => p.poi_id === selectedPoiId);

  async function handleCopyAndOpen() {
    setPostingBusy(true);
    try {
      // V5.0.3: try/catch dedicado no clipboard — algumas policies MV3
      // rejeitam clipboard.write, mas nao queremos que isso bloqueie
      // abrir o post + logar. Copiar e o "nice to have".
      let copyOk = false;
      try {
        await navigator.clipboard.writeText(replyText);
        copyOk = true;
      } catch (clipErr) {
        console.warn("[linkedin] clipboard.writeText falhou:", clipErr);
      }
      setCopiedFlash(copyOk);

      // Abre o post original LinkedIn em nova aba
      let openOk = false;
      if (post.url) {
        openOk = safeOpenUrl(post.url);
        if (!openOk) {
          console.warn("[linkedin] safeOpenUrl rejeitou:", post.url);
        }
      } else {
        console.warn("[linkedin] post.url vazio, nao da pra abrir");
      }

      setTimeout(() => setCopiedFlash(false), 1500);
      await recordPost();
      await onPost();
    } catch (e) {
      console.warn("[linkedin] handleCopyAndOpen erro:", e);
    } finally {
      setPostingBusy(false);
    }
  }

  async function handleRegenerate() {
    if (!onRegenerate || !rateStatus?.allowed) return;
    await recordGeneration();
    await onRegenerate();
    // rate limit refresh
    const s = await checkCanGenerate(dailyLimitConfig);
    setRateStatus({
      allowed: s.allowed,
      reason: s.reason,
      waitMs: s.wait_ms,
      remainingHour: s.remaining_generations_hour,
      remainingDay: s.remaining_posts_day,
    });
  }

  return (
    <article class="rounded border border-zinc-800 bg-zinc-900">
      {/* Rate limit banner — sempre visivel se blocked */}
      {rateStatus && !rateStatus.allowed && (
        <RateLimitBanner status={rateStatus} />
      )}

      <div class="space-y-3 px-3 py-3">
        {/* 1. POI target selector — hidden pra listas manuais (sem POI) */}
        {poiCandidates.length > 0 && (
          <PoiTargetSelector
            candidates={poiCandidates}
            selectedId={selectedPoiId}
            onSelect={onPoiSelect}
          />
        )}

        {/* 2. Strategy note (LLM ou heuristica) */}
        {strategyNote && (
          <div class="rounded border border-sky-900/50 bg-sky-950/25 px-2.5 py-1.5">
            <div class="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-sky-300">
              estrategia
            </div>
            <p class="text-[11px] leading-snug text-sky-100/85">{strategyNote}</p>
          </div>
        )}

        {/* 3. Reply textarea */}
        <div>
          <label
            for="linkedin-reply-text"
            class="mb-1 flex items-baseline justify-between"
          >
            <span class="text-xs font-medium text-zinc-300">
              reply {selectedPoi ? "para" : "sem pessoa-alvo ainda"}{" "}
              {selectedPoi && (
                <span class="font-normal text-zinc-400">
                  â†’ {selectedPoi.poi_name}
                </span>
              )}
            </span>
            <span
              class={`font-mono text-[11px] tabular-nums ${
                overLimit
                  ? "text-red-400"
                  : nearLimit
                  ? "text-amber-400"
                  : "text-zinc-400"
              }`}
              aria-live="polite"
            >
              {charCount} / {charLimit}
            </span>
          </label>
          <textarea
            id="linkedin-reply-text"
            value={replyText}
            onInput={(e) =>
              onReplyChange((e.target as HTMLTextAreaElement).value)
            }
            disabled={isGenerating}
            rows={5}
            aria-invalid={overLimit}
            class={`w-full rounded border bg-zinc-950/60 px-2.5 py-1.5 text-sm text-zinc-100 outline-none disabled:opacity-50 focus:ring-2 focus:ring-offset-1 focus:ring-offset-zinc-900 ${
              overLimit
                ? "border-red-800/60 focus:border-red-500 focus:ring-red-500"
                : "border-zinc-700 focus:border-sky-600 focus:ring-sky-500"
            }`}
            placeholder={isGenerating ? "gerando…" : "sua reply aqui"}
          />
          {overLimit && (
            <p role="alert" class="mt-1 text-[11px] text-red-300">
              acima de {charLimit} chars. LinkedIn corta ou tom fica ruim — encurta.
            </p>
          )}
        </div>

        {/* 4. Action buttons */}
        <div class="flex flex-wrap items-center justify-end gap-1.5">
          {onSkip && (
            <button
              onClick={onSkip}
              disabled={postingBusy}
              class="rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-1 focus:ring-offset-zinc-900"
            >
              pular
            </button>
          )}
          {onRegenerate && (
            <button
              onClick={handleRegenerate}
              disabled={
                isGenerating || postingBusy || !rateStatus?.allowed
              }
              title={
                !rateStatus?.allowed
                  ? "rate limit em vigor — aguarde"
                  : "gerar de novo"
              }
              class="rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-1 focus:ring-offset-zinc-900"
            >
              {isGenerating ? "…" : "regerar"}
            </button>
          )}
          <button
            onClick={handleCopyAndOpen}
            disabled={
              !replyText.trim() ||
              overLimit ||
              // V5.2: POI so e obrigatorio quando ha candidates (bundle Groundswell).
              // Listas manuais nao tem POI e enviam direto.
              (poiCandidates.length > 0 && !selectedPoiId) ||
              postingBusy ||
              copiedFlash
            }
            title={
              poiCandidates.length > 0 && !selectedPoiId
                ? "escolhe uma pessoa-alvo primeiro"
                : "copia reply e abre post pra colar"
            }
            class={`rounded px-2.5 py-1 text-[11px] font-semibold text-white focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-zinc-900 ${
              copiedFlash
                ? "bg-emerald-600 focus:ring-emerald-400"
                : "bg-sky-600 hover:bg-sky-500 focus:ring-sky-400"
            } disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {copiedFlash ? "copiado âœ“" : "copiar + abrir"}
          </button>
        </div>
      </div>
    </article>
  );
}

// ============================================================================
// Rate limit banner (visivel mas nao intrusivo — cor amber, borda solida)
// ============================================================================

function RateLimitBanner({ status }: { status: RateStatus }) {
  const wait = status.waitMs ? formatWait(status.waitMs) : null;
  const label =
    status.reason === "hourly_cap"
      ? "limite horario atingido"
      : status.reason === "daily_cap"
      ? "limite diario atingido"
      : status.reason === "off_hours"
      ? "fora do horario ativo"
      : "cooldown ativo";
  const explanation =
    status.reason === "hourly_cap"
      ? "compliance LinkedIn — bots respondem em cascata. proximo slot"
      : status.reason === "daily_cap"
      ? "contas com >20 posts/dia sao flagadas. reset amanha"
      : status.reason === "off_hours"
      ? "atividade fora do horario ativo (8h–23h) sinaliza bot"
      : "jitter entre generations (60–180s) evita ritmo de bot";

  return (
    <div
      role="status"
      class="flex items-start gap-2 border-b border-amber-900/50 bg-amber-950/25 px-3 py-1.5"
    >
      <span
        aria-hidden="true"
        class="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-amber-600 text-[11px] font-bold text-white"
      >
        !
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-2">
          <span class="text-[11px] font-semibold text-amber-200">
            {label}
          </span>
          {wait && (
            <span class="font-mono text-[11px] tabular-nums text-amber-300">
              volta em {wait}
            </span>
          )}
        </div>
        <p class="mt-0.5 text-[11px] leading-snug text-amber-200/75">
          {explanation}
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// POI target selector — dropdown com heuristica score
// ============================================================================

function PoiTargetSelector({
  candidates,
  selectedId,
  onSelect,
}: {
  candidates: PoiCandidate[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  // V5.2: por default mostra so o top-1 (sugestao). User clica "ver
  // alternativos" pra expandir os demais candidatos. Reduz peso visual em
  // 90%+ dos casos onde o user aceita o top-1.
  const [showAll, setShowAll] = useState(false);
  if (candidates.length === 0) {
    return (
      <div class="rounded border border-zinc-800 bg-zinc-950/50 px-2.5 py-2 text-[11px] text-zinc-400">
        essa conexao nao tem pessoa-alvo na lista. escolhe outro post ou atualiza a lista.
      </div>
    );
  }
  const visible = showAll ? candidates : candidates.slice(0, 1);

  return (
    <div>
      <label
        for="poi-target-select"
        class="mb-1 flex items-baseline justify-between text-xs font-medium text-zinc-300"
      >
        <span>
          pessoa-alvo <span class="text-red-400">*</span>
        </span>
        <span class="text-[11px] uppercase tracking-wide text-zinc-400">
          {showAll
            ? `top ${candidates.length} · ordenado por score`
            : `top 1 de ${candidates.length}`}
        </span>
      </label>
      <div class="space-y-1">
        {visible.map((c, idx) => {
          const active = c.poi_id === selectedId;
          return (
            <button
              key={c.poi_id}
              onClick={() => onSelect(c.poi_id)}
              aria-pressed={active}
              class={`w-full rounded border px-2 py-1.5 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-1 focus:ring-offset-zinc-900 ${
                active
                  ? "border-sky-600 bg-sky-950/40"
                  : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900"
              }`}
            >
              <div class="flex items-baseline justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <div class="flex items-baseline gap-1.5">
                    <span
                      class={`shrink-0 font-mono text-[11px] tabular-nums ${
                        active ? "text-sky-400" : "text-zinc-400"
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <span
                      class={`truncate text-[12px] font-medium ${
                        active ? "text-zinc-100" : "text-zinc-200"
                      }`}
                    >
                      {c.poi_name}
                    </span>
                  </div>
                  <div class="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-400">
                    <span>
                      {c.relation_type.replace(/_/g, " ")}
                    </span>
                    {c.reciprocity && (
                      <span class="text-emerald-400">â†”</span>
                    )}
                    <span class="font-mono tabular-nums">
                      {c.n_interactions} intx
                    </span>
                  </div>
                </div>
                <span
                  class={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums ${
                    active
                      ? "bg-sky-600 text-white"
                      : "bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {c.composite_score.toFixed(2)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {/* V5.2: toggle pra expandir alternativos */}
      {candidates.length > 1 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          class="mt-1 text-[11px] text-sky-400 underline underline-offset-2 hover:text-sky-300"
        >
          {showAll
            ? "esconder alternativos"
            : `ver ${candidates.length - 1} alternativo(s)`}
        </button>
      )}
    </div>
  );
}


