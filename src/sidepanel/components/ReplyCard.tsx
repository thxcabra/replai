import { useState } from "preact/hooks";
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
  onEdit?: (text: string) => void;
}

export function ReplyCard({ reply, index, onEdit }: Props) {
  const [text, setText] = useState(reply.text);
  const [copied, setCopied] = useState(false);

  const charCount = text.length;
  const overLimit = charCount > 280;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback: seleciona o texto pra copia manual
      setCopied(false);
    }
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
        class="reply-edit w-full resize-none rounded border border-transparent bg-transparent text-[13px] leading-snug text-zinc-100 outline-none focus:border-zinc-600"
        value={text}
        rows={2}
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
          onClick={copy}
          class={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            copied
              ? "bg-emerald-500/20 text-emerald-300"
              : "bg-zinc-700/70 text-zinc-100 hover:bg-zinc-600"
          }`}
        >
          {copied ? "copiado!" : "copiar"}
        </button>
      </div>
    </div>
  );
}
