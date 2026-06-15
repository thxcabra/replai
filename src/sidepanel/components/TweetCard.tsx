import type { RenderedTweet } from "../../lib/types";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ReplyCard } from "./ReplyCard";

interface Props {
  data: RenderedTweet;
  replied?: boolean;
  onToggleReplied?: () => void;
  onReplyClick?: (info: {
    tweetId: string;
    tweetUrl?: string;
    tweetAuthor: string;
    tweetText: string;
    replyIndex: number;
    replyText: string;
    replyTextOriginal: string;
    category: string;
    wasEdited: boolean;
    allCandidates: { text: string; category: string }[];
  }) => void;
  onReplyEdit?: (replyIdx: number, text: string) => void;
}

function openUrl(url: string) {
  chrome.tabs.create({ url });
}

export function TweetCard({
  data,
  replied = false,
  onToggleReplied,
  onReplyClick,
  onReplyEdit,
}: Props) {
  const { tweet, result } = data;

  return (
    <article
      class={`rounded-lg border border-zinc-800 bg-zinc-900/70 p-3 shadow-sm transition-opacity ${replied ? "opacity-60" : ""}`}
      aria-label={replied ? `tweet de @${tweet.handle} (respondido)` : `tweet de @${tweet.handle}`}
    >
      {replied && (
        <div class="mb-2">
          <Badge variant="success">✓ respondido</Badge>
        </div>
      )}
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
        <Badge>ISV {tweet.isv.toFixed(1)}</Badge>
        <Badge>L{tweet.inferred_layer}</Badge>
        {tweet.is_poi === 1 && <Badge variant="warning">POI</Badge>}
        {tweet.not_in_graph && <Badge variant="muted">fora do grafo</Badge>}
        <Badge variant="muted" class="ml-auto">
          p{result.pattern}
        </Badge>
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
              tweetId={tweet.tweet_id}
              onReplyClick={
                onReplyClick
                  ? (info) =>
                      onReplyClick({
                        tweetId: tweet.tweet_id,
                        tweetUrl: tweet.url,
                        tweetAuthor: tweet.handle,
                        tweetText: tweet.text,
                        allCandidates: result.replies.map((rep) => ({
                          text: rep.text,
                          category: String(rep.category),
                        })),
                        replyTextOriginal: reply.text,
                        ...info,
                      })
                  : undefined
              }
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
        <Button
          variant="primary"
          size="sm"
          fullWidth
          onClick={() =>
            openUrl(`https://x.com/intent/tweet?in_reply_to=${tweet.tweet_id}`)
          }
        >
          abrir no X
        </Button>
        {tweet.url && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openUrl(tweet.url!)}
          >
            ver tweet
          </Button>
        )}
        {onToggleReplied && (
          <Button
            variant={replied ? "success" : "ghost"}
            size="sm"
            onClick={onToggleReplied}
            title={
              replied
                ? "desmarcar como respondido"
                : "marcar como ja respondido"
            }
          >
            {replied ? "✓ marcado" : "marcar"}
          </Button>
        )}
      </div>
    </article>
  );
}
