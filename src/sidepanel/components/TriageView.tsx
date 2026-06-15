import { useEffect, useState } from "preact/hooks";
import type { EnrichedTweet } from "../../lib/types";
import { SwipeCard } from "./SwipeCard";

export type TriageMode = "list" | "swipe";

interface Props {
  queue: EnrichedTweet[];
  windowHours: number;
  message?: string;
  initialMode?: TriageMode;
  // True quando o "gerar replies" foi clicado e o LLM esta processando.
  // Bloqueia interaction e mostra overlay com spinner.
  generating?: boolean;
  onModeChange?: (mode: TriageMode) => void;
  onGenerate: (selected: EnrichedTweet[]) => void;
  onCancel: () => void;
}

export function TriageView({
  queue,
  windowHours,
  message,
  initialMode = "swipe",
  generating = false,
  onModeChange,
  onGenerate,
  onCancel,
}: Props) {
  const [mode, setMode] = useState<TriageMode>(initialMode);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [swipeIndex, setSwipeIndex] = useState(0);

  // reset interno quando o queue muda (nova triagem)
  useEffect(() => {
    setLiked(new Set());
    setSwipeIndex(0);
  }, [queue]);

  function toggleLike(tweetId: string) {
    setLiked((prev) => {
      const next = new Set(prev);
      if (next.has(tweetId)) next.delete(tweetId);
      else next.add(tweetId);
      return next;
    });
  }

  function selectAll() {
    setLiked(new Set(queue.map((t) => t.tweet_id)));
  }

  function clearAll() {
    setLiked(new Set());
  }

  function switchMode(next: TriageMode) {
    setMode(next);
    onModeChange?.(next);
  }

  function handleGenerate() {
    const selected = queue.filter((t) => liked.has(t.tweet_id));
    onGenerate(selected);
  }

  function handleSwipeLike() {
    const tweet = queue[swipeIndex];
    if (tweet) {
      setLiked((prev) => {
        const next = new Set(prev);
        next.add(tweet.tweet_id);
        return next;
      });
    }
    setSwipeIndex((i) => i + 1);
  }

  function handleSwipeSkip() {
    setSwipeIndex((i) => i + 1);
  }

  const likedCount = liked.size;
  const swipeDone = swipeIndex >= queue.length;

  return (
    <div class="flex min-h-screen flex-col">
      {/* HEADER fixo */}
      <div class="sticky top-0 z-10 border-b border-zinc-800 bg-[#0f1115]/95 px-3 py-2.5 backdrop-blur">
        <div class="flex items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2">
            <h1 class="text-sm font-bold text-zinc-100">triagem</h1>
            <span class="text-[11px] text-zinc-500">
              {queue.length} tweet(s) - janela {windowHours}h
            </span>
          </div>
          <div class="flex items-center gap-1">
            {/* toggle list/swipe */}
            <div class="flex overflow-hidden rounded border border-zinc-700">
              <button
                onClick={() => switchMode("list")}
                class={`px-2 py-1 text-[11px] ${mode === "list" ? "bg-sky-600 text-white" : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"}`}
              >
                lista
              </button>
              <button
                onClick={() => switchMode("swipe")}
                class={`px-2 py-1 text-[11px] ${mode === "swipe" ? "bg-sky-600 text-white" : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"}`}
              >
                swipe
              </button>
            </div>
            <button
              onClick={onCancel}
              class="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
            >
              cancelar
            </button>
          </div>
        </div>
        {message && (
          <div class="mt-1 text-[10px] text-amber-300/80">{message}</div>
        )}
      </div>

      {/* CONTEUDO */}
      {queue.length === 0 ? (
        <div class="flex-1 py-10 text-center text-sm text-zinc-500">
          nenhum tweet pra triar.
        </div>
      ) : mode === "list" ? (
        <ListTriage
          queue={queue}
          liked={liked}
          onToggleLike={toggleLike}
          onSelectAll={selectAll}
          onClearAll={clearAll}
        />
      ) : (
        <SwipeTriage
          queue={queue}
          index={swipeIndex}
          liked={liked}
          done={swipeDone}
          onLike={handleSwipeLike}
          onSkip={handleSwipeSkip}
        />
      )}

      {/* FOOTER fixo: contador + botao gerar */}
      <div class="sticky bottom-0 border-t border-zinc-800 bg-[color:var(--color-bg-base)]/95 px-3 py-2 backdrop-blur">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs text-zinc-400">
            <span class="font-semibold text-emerald-300">{likedCount}</span>{" "}
            selecionado(s)
          </span>
          <button
            onClick={handleGenerate}
            disabled={likedCount === 0 || generating}
            class="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? "gerando..." : `gerar replies (${likedCount})`}
          </button>
        </div>
      </div>

      {/* OVERLAY de loading: bloqueia tudo enquanto LLM esta processando.
          Tweets selecionados sao mostrados em texto pra dar feedback. */}
      {generating && (
        <div
          role="status"
          aria-live="assertive"
          aria-label="gerando replies"
          class="fixed inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 backdrop-blur-sm"
        >
          <div class="h-12 w-12 animate-spin rounded-full border-4 border-emerald-500/30 border-t-emerald-400" />
          <div class="text-center">
            <div class="text-base font-semibold text-zinc-100">
              gerando replies...
            </div>
            <div class="mt-1 text-xs text-zinc-400">
              chamando LLM pra {likedCount} tweet(s) selecionado(s)
            </div>
            <div class="mt-2 text-[10px] text-zinc-500">
              isso costuma levar 5-15 segundos
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- LISTA: todos os tweets, checkbox por linha ----
function ListTriage({
  queue,
  liked,
  onToggleLike,
  onSelectAll,
  onClearAll,
}: {
  queue: EnrichedTweet[];
  liked: Set<string>;
  onToggleLike: (id: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}) {
  const allSelected = liked.size === queue.length;
  return (
    <div class="flex-1 flex-col gap-2 p-3">
      <div class="mb-2 flex gap-1.5 text-[11px]">
        <button
          onClick={onSelectAll}
          class="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800"
        >
          selecionar todos
        </button>
        <button
          onClick={onClearAll}
          class="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800"
        >
          limpar
        </button>
        {allSelected && (
          <span class="ml-auto text-[10px] text-zinc-500">
            todos selecionados
          </span>
        )}
      </div>
      <div class="flex flex-col gap-2">
        {queue.map((tweet) => (
          <TriageRow
            key={tweet.tweet_id}
            tweet={tweet}
            selected={liked.has(tweet.tweet_id)}
            onToggle={() => onToggleLike(tweet.tweet_id)}
          />
        ))}
      </div>
    </div>
  );
}

function TriageRow({
  tweet,
  selected,
  onToggle,
}: {
  tweet: EnrichedTweet;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      class={`group w-full rounded-lg border p-3 text-left transition-colors ${
        selected
          ? "border-emerald-500/60 bg-emerald-500/10"
          : "border-zinc-800 bg-zinc-900/70 hover:border-zinc-700"
      }`}
    >
      <div class="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* check visual de selecao, no inicio pra nao colidir com badges */}
        <div
          class={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold transition-colors ${
            selected
              ? "border-emerald-400 bg-emerald-500 text-white"
              : "border-zinc-600 bg-transparent text-zinc-500 group-hover:border-zinc-400"
          }`}
        >
          {selected ? "✓" : ""}
        </div>
        <span class="text-sm font-semibold text-sky-300">@{tweet.handle}</span>
        <span class="rounded bg-zinc-700/60 px-1.5 py-0.5 text-[10px] text-zinc-200">
          ISV {tweet.isv.toFixed(1)}
        </span>
        <span class="rounded bg-zinc-700/60 px-1.5 py-0.5 text-[10px] text-zinc-200">
          L{tweet.inferred_layer}
        </span>
        {tweet.is_poi === 1 && (
          <span class="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
            POI
          </span>
        )}
        {tweet.not_in_graph && (
          <span class="rounded bg-zinc-600/40 px-1.5 py-0.5 text-[10px] text-zinc-400">
            fora do grafo
          </span>
        )}
      </div>
      <p class="whitespace-pre-wrap text-[13px] leading-snug text-zinc-200">
        {tweet.text}
      </p>
      {tweet.context && (
        <p class="mt-1.5 rounded bg-zinc-800/50 px-2 py-1 text-[11px] italic text-zinc-400">
          {tweet.context}
        </p>
      )}
    </button>
  );
}

// ---- SWIPE: um card por vez, gesture left/right ----
function SwipeTriage({
  queue,
  index,
  liked,
  done,
  onLike,
  onSkip,
}: {
  queue: EnrichedTweet[];
  index: number;
  liked: Set<string>;
  done: boolean;
  onLike: () => void;
  onSkip: () => void;
}) {
  if (done) {
    return (
      <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <div class="text-base font-semibold text-zinc-200">triagem completa</div>
        <div class="text-sm text-zinc-400">
          {liked.size} de {queue.length} selecionado(s).
        </div>
        <div class="text-xs text-zinc-500">
          clica "gerar replies" abaixo, ou troca pra modo lista pra ajustar.
        </div>
      </div>
    );
  }

  const tweet = queue[index];
  if (!tweet) return null;

  return (
    <div class="flex flex-1 flex-col items-center gap-3 p-3">
      <div class="text-[11px] text-zinc-500">
        {index + 1} / {queue.length}
      </div>

      <SwipeCard key={tweet.tweet_id} onLike={onLike} onSkip={onSkip}>
        <div class="rounded-lg border border-zinc-700 bg-zinc-900/90 p-4 shadow-lg">
          <div class="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="text-sm font-semibold text-sky-300">
              @{tweet.handle}
            </span>
            <span class="rounded bg-zinc-700/60 px-1.5 py-0.5 text-[10px] text-zinc-200">
              ISV {tweet.isv.toFixed(1)}
            </span>
            <span class="rounded bg-zinc-700/60 px-1.5 py-0.5 text-[10px] text-zinc-200">
              L{tweet.inferred_layer}
            </span>
            {tweet.is_poi === 1 && (
              <span class="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                POI
              </span>
            )}
          </div>
          <p class="whitespace-pre-wrap text-[14px] leading-relaxed text-zinc-100">
            {tweet.text}
          </p>
          {tweet.context && (
            <p class="mt-2 rounded bg-zinc-800/50 px-2 py-1 text-[11px] italic text-zinc-400">
              {tweet.context}
            </p>
          )}
        </div>
      </SwipeCard>

      <div class="flex w-full max-w-sm justify-between gap-3">
        <button
          onClick={onSkip}
          class="flex-1 rounded-full border-2 border-red-500/60 bg-red-500/10 py-2 text-sm font-semibold text-red-300 hover:bg-red-500/20"
        >
          ✕ skip
        </button>
        <button
          onClick={onLike}
          class="flex-1 rounded-full border-2 border-emerald-500/60 bg-emerald-500/10 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/20"
        >
          ♥ like
        </button>
      </div>

      <div class="text-[10px] text-zinc-500">
        ← swipe ou setas do teclado →
      </div>
    </div>
  );
}
