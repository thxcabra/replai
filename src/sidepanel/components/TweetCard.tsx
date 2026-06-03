import type { RenderedTweet } from "../../lib/types";
import { ReplyCard } from "./ReplyCard";

interface Props {
  data: RenderedTweet;
  replied?: boolean;
  onToggleReplied?: () => void;
  onReplyEdit?: (replyIdx: number, text: string) => void;
}

function openUrl(url: string) {
  chrome.tabs.create({ url });
}

export function TweetCard({
  data,
  replied = false,
  onToggleReplied,
  onReplyEdit,
}: Props) {
  const { tweet, result } = data;

  return (
    <div
      class={`rounded-lg border border-zinc-800 bg-zinc-900/70 p-3 shadow-sm transition-opacity ${replied ? "opacity-50" : ""}`}
    >
      {/* header */}
      <div class="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <a
          href={`https://x.com/${tweet.handle}`}
          target="_blank"
          rel="noreferrer"
          class="text-sm font-semibold text-sky-300 hover:underline"
        >
          @{tweet.handle}
        </a>
        <span class="rounded bg-zinc-700/60 px-1.5 py-0.5 text-[10px] font-medium text-zinc-200">
          ISV {tweet.isv.toFixed(1)}
        </span>
        <span class="rounded bg-zinc-700/60 px-1.5 py-0.5 text-[10px] font-medium text-zinc-200">
          layer {tweet.inferred_layer}
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
        <span class="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
          padrao {result.pattern}
        </span>
      </div>

      {/* texto do tweet */}
      <p class="mb-2 whitespace-pre-wrap text-[13px] leading-snug text-zinc-200">
        {tweet.text}
      </p>

      {tweet.context && (
        <p class="mb-2 rounded bg-zinc-800/50 px-2 py-1 text-[11px] italic text-zinc-400">
          {tweet.context}
        </p>
      )}

      {tweet.is_limited_reply && (
        <p class="mb-2 rounded bg-yellow-500/10 px-2 py-1 text-[11px] text-yellow-400">
          atencao: este tweet pode ter respostas limitadas.
        </p>
      )}

      {/* replies */}
      {result.replies.length > 0 ? (
        <div class="flex flex-col gap-2">
          {result.replies.map((reply, i) => (
            <ReplyCard
              key={i}
              reply={reply}
              index={i}
              onEdit={
                onReplyEdit ? (text) => onReplyEdit(i, text) : undefined
              }
            />
          ))}
        </div>
      ) : (
        <p class="rounded bg-zinc-800/40 px-2 py-1.5 text-[11px] text-zinc-500">
          modo dry-run: passou no filtro, replies nao geradas.
        </p>
      )}

      {/* acoes */}
      <div class="mt-2.5 flex gap-2">
        <button
          onClick={() =>
            openUrl(`https://x.com/intent/tweet?in_reply_to=${tweet.tweet_id}`)
          }
          class="flex-1 rounded bg-sky-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
        >
          abrir no X
        </button>
        {tweet.url && (
          <button
            onClick={() => openUrl(tweet.url!)}
            class="rounded border border-zinc-700 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            ver tweet
          </button>
        )}
        {onToggleReplied && (
          <button
            onClick={onToggleReplied}
            title={
              replied
                ? "desmarcar como respondido"
                : "marcar como ja respondido"
            }
            class={`rounded border px-2 py-1.5 text-xs ${
              replied
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            {replied ? "✓ respondido" : "marcar"}
          </button>
        )}
      </div>
    </div>
  );
}
