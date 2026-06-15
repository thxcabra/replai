import { useEffect, useRef, useState } from "preact/hooks";
import { categoryLabel } from "../../lib/constants";
import { track } from "../../lib/metrics";
import type { SkillReply } from "../../lib/types";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

interface Props {
  reply: SkillReply;
  index: number;
  tweetId: string;
  onEdit?: (text: string) => void;
  onReplyClick?: (info: {
    replyIndex: number;
    replyText: string;
    category: string;
    wasEdited: boolean;
  }) => void;
}

export function ReplyCard({
  reply,
  index,
  tweetId,
  onEdit,
  onReplyClick,
}: Props) {
  const [text, setText] = useState(reply.text);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // auto-resize: cresce com o conteudo. Limite max pra nao engolir mobile.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, [text]);

  const charCount = text.length;
  const overLimit = charCount > 280;

  function respond() {
    const wasEdited = text !== reply.text;
    track(
      "reply_clicked",
      {
        tweet_id: tweetId,
        reply_index: index,
        category: reply.category,
        was_edited: wasEdited,
        edited_len: text.length,
        original_len: reply.text.length,
      },
      null
    );
    // intent do X: abre o composer ja com o texto preenchido em resposta ao tweet
    const url = `https://x.com/intent/post?in_reply_to=${encodeURIComponent(
      tweetId
    )}&text=${encodeURIComponent(text)}`;
    chrome.tabs.create({ url });
    // dispara o PostConfirmDialog via App
    onReplyClick?.({
      replyIndex: index,
      replyText: text,
      category: String(reply.category),
      wasEdited,
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
        class="w-full max-h-[280px] resize-none overflow-y-auto rounded border border-transparent bg-transparent text-[13px] leading-snug text-zinc-100 outline-none focus:border-zinc-600"
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
        <Button
          variant="primary"
          size="sm"
          onClick={respond}
          title="abre o X com a reply pronta e marca como respondido"
        >
          responder
        </Button>
      </div>
    </div>
  );
}
