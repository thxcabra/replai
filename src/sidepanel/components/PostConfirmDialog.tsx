import { useEffect, useState } from "preact/hooks";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Textarea } from "../ui/Input";

interface Props {
  pendingTweetId: string;
  tweetText: string;          // texto do tweet original
  tweetHandle: string;        // @handle do autor
  replyIndex: number;
  actionType?: "reply" | "quote_tweet";
  // Reply ORIGINAL (texto que foi pro composer ao clicar). E o ponto de partida
  // do que o usuario edita aqui se mudou no X.
  originalReplyText: string;
  category: string;
  wasEdited: boolean;         // ja editou antes de mandar?
  // info: usuario postou, e opcionalmente com texto final + reply_id do X
  onConfirmPosted: (data: {
    finalReplyText: string;          // texto final que foi pro X (com edits)
    postedReplyId: string | null;    // ID da reply postada no X (https://x.com/.../status/<ID>)
    wasEditedInDialog: boolean;      // editou no dialog (alem do que ja editou antes)?
    // V4.1 — 2.10: analista marca se autor ja deu sinal de engajamento
    // (like/reply/follow) no momento do post — vira sinal de treino futuro.
    authorEngagedAtPost: boolean;
  }) => void;
  onSkipped: () => void;
  onEditAgain: () => void;
}

// Dialog pos-clique de "responder". Captura confirmacao + texto final +
// ID da reply postada no X (opcional, pra rastreio).
//
// User flow:
//   1. clica responder em ReplyCard
//   2. composer do X abre noutra aba
//   3. user posta no X (ou nao), copia o link da reply postada (opcional)
//   4. volta pra extension, ve dialog
//   5. se posto com mesmo texto: clica "sim, postei" direto
//   6. se postou diferente: edita textarea + cola URL/ID da reply -> "sim, postei"
//   7. se nao postou: "nao postei"
export function PostConfirmDialog({
  pendingTweetId,
  tweetText,
  tweetHandle,
  replyIndex,
  actionType = "reply",
  originalReplyText,
  wasEdited,
  onConfirmPosted,
  onSkipped,
  onEditAgain,
}: Props) {
  const isQt = actionType === "quote_tweet";
  const [finalText, setFinalText] = useState(originalReplyText);
  const [replyIdInput, setReplyIdInput] = useState("");
  const [authorEngaged, setAuthorEngaged] = useState(false);

  useEffect(() => {
    setFinalText(originalReplyText);
    setReplyIdInput("");
    setAuthorEngaged(false);
  }, [originalReplyText]);

  function extractReplyId(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    // aceita URL completa (https://x.com/user/status/123) ou so o ID
    const m = trimmed.match(/status\/(\d+)/);
    if (m) return m[1];
    if (/^\d{5,}$/.test(trimmed)) return trimmed;
    return null;
  }

  function handleConfirm() {
    const wasEditedInDialog = finalText.trim() !== originalReplyText.trim();
    onConfirmPosted({
      finalReplyText: finalText,
      postedReplyId: extractReplyId(replyIdInput),
      wasEditedInDialog,
      authorEngagedAtPost: authorEngaged,
    });
  }

  const charCount = finalText.length;
  const overLimit = charCount > 280;
  const replyIdParsed = extractReplyId(replyIdInput);
  const replyIdInvalid = replyIdInput.trim().length > 0 && !replyIdParsed;

  return (
    <Dialog
      open
      onClose={onEditAgain}
      title={
        isQt
          ? "voce postou esse Quote Tweet no X?"
          : "voce postou essa reply no X?"
      }
      description={
        isQt
          ? `Quote Tweet de @${tweetHandle}`
          : `reply #${replyIndex + 1} para @${tweetHandle}`
      }
      maxWidth={560}
    >
      <div class="flex flex-col gap-3">
        {wasEdited && (
          <div>
            <Badge variant="warning">editada antes do clique</Badge>
          </div>
        )}

        {/* Tweet original — analista lembra qual era */}
        <div class="rounded border border-zinc-800 bg-zinc-950 p-2">
          <div class="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
            tweet original (@{tweetHandle})
          </div>
          <p class="max-h-24 overflow-y-auto whitespace-pre-wrap text-[12px] leading-snug text-zinc-300">
            {tweetText}
          </p>
        </div>

        {/* Reply final (editavel) — se postou texto diferente, edita aqui */}
        <Textarea
          label="texto final que foi pro X (edite se mudou no composer)"
          value={finalText}
          onInput={(e) =>
            setFinalText((e.target as HTMLTextAreaElement).value)
          }
          class="max-h-40"
          rows={4}
        />
        <div class="-mt-2 flex items-center justify-between">
          <span
            class={`text-[10px] tabular-nums ${overLimit ? "text-red-400" : "text-zinc-500"}`}
          >
            {charCount}/280
          </span>
          {finalText.trim() !== originalReplyText.trim() && (
            <Badge variant="warning">texto alterado</Badge>
          )}
        </div>

        {/* URL do post — DESTACADO. Replies com URL viram "verificadas" no
            painel admin, sinal mais forte de que foi postado de verdade vs
            auto-report. Por isso vale a pena reservar tempo pra colar. */}
        <div
          class={`rounded-lg border-2 p-2.5 transition-colors ${
            replyIdParsed
              ? "border-emerald-500/60 bg-emerald-500/5"
              : "border-amber-500/40 bg-amber-500/5"
          }`}
        >
          <div class="mb-1.5 flex items-center justify-between gap-2">
            <label class="text-xs font-semibold text-amber-200">
              📋 cole o link da reply postada
            </label>
            {replyIdParsed ? (
              <Badge variant="success">verificada ✓</Badge>
            ) : (
              <Badge variant="warning">opcional</Badge>
            )}
          </div>
          <input
            type="text"
            class={`w-full rounded border bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 outline-none transition-colors focus:border-amber-400 ${
              replyIdInvalid
                ? "border-red-500"
                : replyIdParsed
                  ? "border-emerald-500/40"
                  : "border-amber-500/40"
            }`}
            placeholder="https://x.com/seu_user/status/1234567890..."
            value={replyIdInput}
            onInput={(e) =>
              setReplyIdInput((e.target as HTMLInputElement).value)
            }
          />
          <div class="mt-1 text-[11px] leading-snug text-zinc-400">
            {replyIdParsed ? (
              <span class="text-emerald-300">
                id capturado: <code class="font-mono">{replyIdParsed}</code> —
                esta reply vai contar como <strong>verificada</strong> no painel
                admin.
              </span>
            ) : replyIdInvalid ? (
              <span class="text-red-400">
                formato invalido. cole a URL completa do X ou so o ID numerico.
              </span>
            ) : (
              <span>
                <strong>como pegar:</strong> volta no X, clica nos "..." da tua
                reply postada → "copy link" → cola aqui. ou pega da barra de
                endereco. permite trackear engagement (likes/RTs) depois +
                conta como "verificada" no painel.
              </span>
            )}
          </div>
        </div>

        {/* V4.1 — 2.10: feedback opcional pro scorer aprender */}
        <label class="flex items-start gap-2 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-300">
          <input
            type="checkbox"
            class="mt-0.5"
            checked={authorEngaged}
            onChange={(e) =>
              setAuthorEngaged((e.target as HTMLInputElement).checked)
            }
          />
          <span>
            o autor ja deu sinal de engajamento (like, reply, follow)?
            <span class="block text-zinc-500">
              opcional — sinal pro filtro aprender quais replies funcionam.
            </span>
          </span>
        </label>

        <div class="flex flex-col gap-1.5">
          <Button
            variant="success"
            size="md"
            onClick={handleConfirm}
            fullWidth
          >
            sim, postei
          </Button>
          <div class="flex gap-1.5">
            <Button variant="ghost" size="md" onClick={onEditAgain} fullWidth>
              voltar pra editar
            </Button>
            <Button variant="ghost" size="md" onClick={onSkipped} fullWidth>
              nao postei
            </Button>
          </div>
        </div>

        <div class="text-[10px] text-zinc-500">
          tweet id: {pendingTweetId.slice(0, 16)}...
        </div>
      </div>
    </Dialog>
  );
}
