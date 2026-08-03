import { useEffect, useState } from "preact/hooks";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Textarea } from "../ui/Input";

interface Props {
  open: boolean;
  angle: string;
  category: string;
  originalBody: string;
  // Captura: voce postou? + URL da tweet postada (opcional, mas vira "verificado")
  onConfirmPosted: (data: {
    finalBody: string;
    postedPostId: string | null;
    wasEditedInDialog: boolean;
  }) => void;
  onSkipped: () => void;
  onClose: () => void;
}

// V4.1.8 — PostConfirmFlow: dialog que captura confirmacao + URL do post
// publicado no X. Equivalente a PostConfirmDialog que ja existe pros replies.
//
// Fluxo:
//   1. analista clica "abrir no X" no PostsView com a sugestao
//   2. composer do X abre em nova aba com texto preenchido
//   3. analista posta (ou nao), volta pro Replai
//   4. este dialog aparece pedindo confirmacao + URL
//   5. URL preenchida = badge "verificado" no analytics (sinal mais forte)
export function PostConfirmFlow({
  open,
  angle,
  category,
  originalBody,
  onConfirmPosted,
  onSkipped,
  onClose,
}: Props) {
  const [finalText, setFinalText] = useState(originalBody);
  const [postIdInput, setPostIdInput] = useState("");

  useEffect(() => {
    setFinalText(originalBody);
    setPostIdInput("");
  }, [originalBody]);

  function extractPostId(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    // aceita URL completa (https://x.com/user/status/123) ou so o ID numerico
    const m = trimmed.match(/status\/(\d+)/);
    if (m) return m[1];
    if (/^\d{5,}$/.test(trimmed)) return trimmed;
    return null;
  }

  function handleConfirm() {
    const wasEditedInDialog = finalText.trim() !== originalBody.trim();
    onConfirmPosted({
      finalBody: finalText,
      postedPostId: extractPostId(postIdInput),
      wasEditedInDialog,
    });
  }

  const charCount = finalText.length;
  const overLimit = charCount > 280;
  const postIdParsed = extractPostId(postIdInput);
  const postIdInvalid = postIdInput.trim().length > 0 && !postIdParsed;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="voce postou esse post no X?"
      description={`${angle} · ${category}`}
      maxWidth={560}
    >
      <div class="flex flex-col gap-3">
        {/* texto final (editavel) */}
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
          {finalText.trim() !== originalBody.trim() && (
            <Badge variant="warning">texto alterado</Badge>
          )}
        </div>

        {/* URL do post — DESTACADO. Posts com URL viram "verificados" */}
        <div
          class={`rounded-lg border-2 p-2.5 transition-colors ${
            postIdParsed
              ? "border-emerald-500/60 bg-emerald-500/5"
              : "border-amber-500/40 bg-amber-500/5"
          }`}
        >
          <div class="mb-1.5 flex items-center justify-between gap-2">
            <label class="text-xs font-semibold text-amber-200">
              📋 cole o link do post publicado
            </label>
            {postIdParsed ? (
              <Badge variant="success">verificado ✓</Badge>
            ) : (
              <Badge variant="warning">opcional</Badge>
            )}
          </div>
          <input
            type="text"
            class={`w-full rounded border bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 outline-none transition-colors focus:border-amber-400 ${
              postIdInvalid
                ? "border-red-500"
                : postIdParsed
                  ? "border-emerald-500/40"
                  : "border-amber-500/40"
            }`}
            placeholder="https://x.com/seu_user/status/1234567890..."
            value={postIdInput}
            onInput={(e) =>
              setPostIdInput((e.target as HTMLInputElement).value)
            }
          />
          <div class="mt-1 text-[11px] leading-snug text-zinc-400">
            {postIdParsed ? (
              <span class="text-emerald-300">
                id capturado: <code class="font-mono">{postIdParsed}</code> —
                esse post vai contar como <strong>verificado</strong>.
              </span>
            ) : postIdInvalid ? (
              <span class="text-red-400">
                formato invalido. cole a URL completa ou so o ID numerico.
              </span>
            ) : (
              <span>
                <strong>como pegar:</strong> volta no X, clica nos "..." do
                post → "copy link" → cola aqui. permite trackear engagement
                depois + conta como "verificado".
              </span>
            )}
          </div>
        </div>

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
            <Button variant="ghost" size="md" onClick={onClose} fullWidth>
              voltar pra editar
            </Button>
            <Button variant="ghost" size="md" onClick={onSkipped} fullWidth>
              nao postei
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
