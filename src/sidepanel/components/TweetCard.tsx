import { useState } from "preact/hooks";
import { safeOpenUrl } from "../../lib/safe-url";
import type { RenderedTweet } from "../../lib/types";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ReplyCard } from "./ReplyCard";

import type { ReplyActionType } from "./ReplyCard";

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
    actionType: ReplyActionType;
    allCandidates: { text: string; category: string }[];
  }) => void;
  onReplyEdit?: (replyIdx: number, text: string) => void;
  // V4.1 — 2.6: regen individual
  onRegenerateReply?: (replyIdx: number, attachmentUrl?: string) => Promise<void>;
  regeneratingIndex?: number | null;
  // V4.1 — 2.5: attachment URL persisted (per-tweet) — controlado pelo App
  attachmentUrl?: string;
  onAttachmentChange?: (url: string) => void;
}

function openUrl(url: string) {
  // V4.1.14 (CR-05): valida scheme + host antes de abrir tab
  safeOpenUrl(url);
}

export function TweetCard({
  data,
  replied = false,
  onToggleReplied,
  onReplyClick,
  onReplyEdit,
  onRegenerateReply,
  regeneratingIndex,
  attachmentUrl = "",
  onAttachmentChange,
}: Props) {
  const { tweet, result } = data;
  const [attachOpen, setAttachOpen] = useState(false);
  const tier = tweet.author_context?.tier;
  const cooldown = tweet.author_context?.cooldown_recommended;
  const isFirstContact = tweet.author_context?.is_first_contact;
  const isHotTopic = tweet.intelligence?.batch_signals?.is_part_of_hot_topic;
  const personaScore = tweet.persona_relevance;
  const engagementScore = tweet.engagement_potential;

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

      {/* V4.1 — 2.2: imagens do tweet (foto/gif/video preview) */}
      {tweet.media && tweet.media.length > 0 && (
        <div
          class={`mb-2 grid gap-1 ${tweet.media.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}
        >
          {tweet.media.slice(0, 4).map((m, i) => (
            <a
              key={i}
              href={m.url}
              target="_blank"
              rel="noreferrer"
              class="relative block overflow-hidden rounded border border-zinc-700 bg-zinc-950"
              title={`abrir ${m.type} em nova aba`}
            >
              <img
                src={m.thumbnailUrl ?? m.url}
                alt={`${m.type} de @${tweet.handle}`}
                class="h-full max-h-40 w-full object-cover"
                loading="lazy"
              />
              {m.type !== "photo" && (
                <span class="absolute right-1 top-1 rounded bg-black/70 px-1 py-0.5 text-[10px] uppercase text-white">
                  {m.type}
                </span>
              )}
            </a>
          ))}
        </div>
      )}

      {/* V4.1 — 2.11/2.10: chips de inteligencia + scores. Reduz chip-soup
          combinando tier+voz+eng num chip composito unico; sinais binarios
          (cooldown/1a interacao/topico quente) so aparecem quando true. */}
      {(tier ||
        cooldown ||
        isFirstContact ||
        isHotTopic ||
        personaScore !== undefined) && (
        <div class="mb-2 flex flex-wrap items-center gap-1.5">
          {/* Chip composito: tier · voz · eng (so o que existe) */}
          {(tier || personaScore != null || engagementScore != null) && (
            <span
              class="inline-flex items-center gap-1 rounded bg-zinc-800/70 px-1.5 py-0.5 text-[10px] text-zinc-300"
              title={tweet.selection_reason ?? "scores do filtro de selecao"}
            >
              {tier && (
                <span
                  class={`font-medium ${
                    tier === "mega"
                      ? "text-violet-300"
                      : tier === "large"
                        ? "text-sky-300"
                        : tier === "mid"
                          ? "text-emerald-300"
                          : "text-zinc-400"
                  }`}
                >
                  {tier}
                </span>
              )}
              {personaScore != null && (
                <>
                  {tier && <span class="text-zinc-600">·</span>}
                  <span>voz {personaScore}</span>
                </>
              )}
              {engagementScore != null && (
                <>
                  <span class="text-zinc-600">·</span>
                  <span class="text-orange-300">eng {engagementScore}</span>
                </>
              )}
            </span>
          )}
          {/* Sinais binarios — so 1 ativo por vez na maioria dos casos */}
          {cooldown && (
            <span
              class="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-300"
              title="ja respondemos 3+ vezes sem retorno nos ultimos 30 dias"
            >
              cooldown
            </span>
          )}
          {!cooldown && isFirstContact && (
            <span
              class="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300"
              title="primeira interacao com este autor"
            >
              1a interacao
            </span>
          )}
          {isHotTopic && (
            <span
              class="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300"
              title="topico mencionado por multiplos autores neste batch"
            >
              topico quente
            </span>
          )}
        </div>
      )}

      {/* V4.1 — 2.5: attachment URL extra (paperclip toggle inline) */}
      {onAttachmentChange && (
        <div class="mb-2">
          <button
            type="button"
            class="text-[10px] text-zinc-500 hover:text-zinc-300"
            onClick={() => setAttachOpen((v) => !v)}
            title="adicionar URL extra como contexto pra geracao de reply"
            aria-label={
              attachmentUrl
                ? "editar URL de contexto anexada"
                : "adicionar URL de contexto pra geracao de reply"
            }
            aria-expanded={attachOpen}
          >
            <span aria-hidden="true">📎</span>{" "}
            {attachmentUrl
              ? "contexto anexado (clique pra editar)"
              : "adicionar URL de contexto (opcional)"}
          </button>
          {attachOpen && (
            <input
              type="url"
              value={attachmentUrl}
              onInput={(e) =>
                onAttachmentChange(
                  (e.target as HTMLInputElement).value
                )
              }
              placeholder="https://link.do/report-citado..."
              class="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-sky-600"
            />
          )}
        </div>
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
              tweetUrl={tweet.url}
              regenerating={regeneratingIndex === i}
              onRegenerate={
                onRegenerateReply
                  ? (attachmentUrl?: string) =>
                      onRegenerateReply(i, attachmentUrl)
                  : undefined
              }
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
