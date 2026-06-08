import { useEffect, useRef, useState } from "preact/hooks";
import type { SkillReply } from "../../lib/types";

const CATEGORY_LABELS: Record<string, string> = {
  dado_concreto: "dado concreto",
  referencia_nominal: "referencia nominal",
  experiencia_builder: "experiencia builder",
  pergunta_especialista: "pergunta especialista",
  info_pratica: "info pratica",
  nomear_fenomeno: "nomear fenomeno",
  caso_concreto: "caso concreto",
  cross_pollination: "cross-pollination",
  update_info: "update info",
};

interface Props {
  reply: SkillReply;
  index: number;
  tweetId: string;
  onEdit?: (text: string) => void;
  onMarkReplied?: () => void;
}

export function ReplyCard({
  reply,
  index,
  tweetId,
  onEdit,
  onMarkReplied,
}: Props) {
  const [text, setText] = useState(reply.text);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // auto-resize: cresce com o conteudo sem truncar.
  // funciona em qualquer navegador (independente de suporte a field-sizing).
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const charCount = text.length;
  const overLimit = charCount > 280;

  function respond() {
    // intent do X: abre o composer ja com o texto preenchido em resposta ao tweet
    const url = `https://x.com/intent/post?in_reply_to=${encodeURIComponent(
      tweetId
    )}&text=${encodeURIComponent(text)}`;
    chrome.tabs.create({ url });
    onMarkReplied?.();
  }

  const label = CATEGORY_LABELS[reply.category] ?? reply.category;

  return (
    <div class="rounded-md border border-zinc-700/60 bg-zinc-900/40 p-2.5">
      <div class="mb-1.5 flex items-center gap-2">
        <span class="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-300">
          reply {index + 1}
        </span>
        <span class="text-[11px] text-zinc-400">{label}</span>
      </div>

      <textarea
        ref={taRef}
        class="w-full resize-none overflow-hidden rounded border border-transparent bg-transparent text-[13px] leading-snug text-zinc-100 outline-none focus:border-zinc-600"
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
        <button
          onClick={respond}
          title="abre o X com a reply pronta e marca como respondido"
          class="rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-sky-500"
        >
          responder
        </button>
      </div>
    </div>
  );
}
