import { useEffect, useRef, useState } from "preact/hooks";
import { categoryLabel } from "../../lib/constants";
import { track } from "../../lib/metrics";
import { safeOpenUrl } from "../../lib/safe-url";
import type { SkillReply } from "../../lib/types";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

export type ReplyActionType = "reply" | "quote_tweet";

interface Props {
  reply: SkillReply;
  index: number;
  tweetId: string;
  tweetUrl?: string;            // necessario pra QT (intent precisa do URL completo)
  onEdit?: (text: string) => void;
  onReplyClick?: (info: {
    replyIndex: number;
    replyText: string;
    category: string;
    wasEdited: boolean;
    actionType: ReplyActionType;
  }) => void;
  // V4.1 — 2.6: regenerar essa reply especifica
  onRegenerate?: (attachmentUrl?: string) => Promise<void>;
  regenerating?: boolean;
}

export function ReplyCard({
  reply,
  index,
  tweetId,
  tweetUrl,
  onEdit,
  onReplyClick,
  onRegenerate,
  regenerating,
}: Props) {
  const [text, setText] = useState(reply.text);
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenAttachmentUrl, setRegenAttachmentUrl] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // sincroniza texto quando reply muda (apos regen, reply.text e novo)
  useEffect(() => {
    setText(reply.text);
  }, [reply.text]);

  async function confirmRegen() {
    if (!onRegenerate) return;
    setRegenOpen(false);
    await onRegenerate(regenAttachmentUrl.trim() || undefined);
    setRegenAttachmentUrl("");
  }

  // auto-resize: cresce com o conteudo. Limite max pra nao engolir mobile.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, [text]);

  const charCount = text.length;
  const overLimit = charCount > 280;

  function dispatch(actionType: ReplyActionType) {
    const wasEdited = text !== reply.text;
    track(
      actionType === "quote_tweet" ? "quote_tweet_clicked" : "reply_clicked",
      {
        tweet_id: tweetId,
        reply_index: index,
        category: reply.category,
        was_edited: wasEdited,
        edited_len: text.length,
        original_len: reply.text.length,
        action_type: actionType,
      },
      null
    );
    // intent do X. Reply: in_reply_to=<id>. QT: url=<tweet_url> (X infere QT
    // quando o URL de um tweet vai como anexo).
    let url: string;
    if (actionType === "quote_tweet" && tweetUrl) {
      url = `https://x.com/intent/post?text=${encodeURIComponent(
        text
      )}&url=${encodeURIComponent(tweetUrl)}`;
    } else {
      url = `https://x.com/intent/post?in_reply_to=${encodeURIComponent(
        tweetId
      )}&text=${encodeURIComponent(text)}`;
    }
    // V4.1.14 (CR-05): valida scheme + host antes de abrir tab
    safeOpenUrl(url);
    // dispara o PostConfirmDialog via App
    onReplyClick?.({
      replyIndex: index,
      replyText: text,
      category: String(reply.category),
      wasEdited,
      actionType,
    });
  }

  return (
    <div class="rounded-md border border-zinc-700/60 bg-zinc-900/40 p-2.5">
      <div class="mb-1.5 flex items-center gap-2">
        <Badge variant="accent">reply {index + 1}</Badge>
        <span class="text-[11px] text-zinc-400">{categoryLabel(reply.category)}</span>
      </div>

      <textarea
        ref={taRef}
        class="w-full max-h-72 resize-none overflow-y-auto rounded border border-transparent bg-transparent text-[13px] leading-snug text-zinc-100 outline-none focus:border-zinc-600"
        value={text}
        rows={1}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        onBlur={() => {
          if (text !== reply.text) onEdit?.(text);
        }}
      />

      <div class="mt-1.5 flex items-center justify-between">
        <span
          class={`text-[10px] tabular-nums ${
            overLimit ? "text-red-400" : "text-zinc-500"
          }`}
        >
          {charCount}/280
        </span>
        <div class="flex items-center gap-1.5">
          {onRegenerate && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRegenOpen(true)}
              disabled={regenerating}
              title="regenerar essa reply (mantem as outras)"
            >
              {regenerating ? "..." : "regerar"}
            </Button>
          )}
          {tweetUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dispatch("quote_tweet")}
              disabled={regenerating}
              title="abre o X em modo Quote Tweet (com link do tweet original)"
            >
              QT
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => dispatch("reply")}
            disabled={regenerating}
            title="abre o X com a reply pronta e marca como respondido"
          >
            responder
          </Button>
        </div>
      </div>

      {/* V4.1 — 2.6: dialog de regen com attachment URL opcional */}
      {regenOpen && (
        <Dialog
          open
          onClose={() => setRegenOpen(false)}
          title={`regerar reply #${index + 1}`}
          description="vai gerar uma reply nova em categoria diferente. as outras replies deste tweet permanecem."
          maxWidth={480}
        >
          <div class="flex flex-col gap-3">
            <div>
              <label class="mb-1 block text-xs font-medium text-zinc-400">
                URL de contexto extra (opcional)
              </label>
              <input
                type="url"
                placeholder="https://link.do/report-citado..."
                class="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-sky-600"
                value={regenAttachmentUrl}
                onInput={(e) =>
                  setRegenAttachmentUrl(
                    (e.target as HTMLInputElement).value
                  )
                }
              />
            </div>
            <div class="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="md"
                onClick={() => setRegenOpen(false)}
              >
                cancelar
              </Button>
              <Button variant="primary" size="md" onClick={confirmRegen}>
                gerar
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
