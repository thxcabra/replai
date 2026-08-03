// V5.2 — Aba Posts LinkedIn.
//
// Pipeline especifico do LinkedIn (nao usa Watchtower/Notion — nao ha):
//   - Fonte: replies LinkedIn recentes (linkedin_replies com decision=posted)
//   - Contexto: pessoas-alvo top do bundle Groundswell ativo
//   - LLM: Gemini Flash com prompt LinkedIn (longform, formal, sem imagem)
//
// UI: mesma cara da PostsView do X mas sem watchtowerDate, sem mode selector
// (LinkedIn tem so um pipeline), sem imagem. Cards menores (LinkedIn body 3-5
// linhas — cabe direto sem hook separado grande).

import { useState } from "preact/hooks";
import {
  suggestLinkedInPosts,
  type LinkedInPostsResult,
  type LinkedInPostSuggestion,
} from "../../../lib/channels/linkedin/posts-suggestion";
import { safeOpenUrl } from "../../../lib/safe-url";
import type { Workspace } from "../../../lib/types";
import { Button } from "../../ui/Button";

interface Props {
  workspace: Workspace;
  onClose: () => void;
  result: LinkedInPostsResult | null;
  setResult: (r: LinkedInPostsResult | null) => void;
}

export function LinkedInPostsView({ workspace, onClose, result, setResult }: Props) {
  const [loading, setLoading] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const voice = (workspace.config.linkedin_voice ?? "").trim();

  async function runSuggest() {
    setLoading(true);
    try {
      const out = await suggestLinkedInPosts(workspace);
      setResult(out);
    } catch (e) {
      setResult({
        suggestions: [],
        recentReplies: [],
        poiSample: [],
        ms: 0,
        errors: [`Erro inesperado: ${(e as Error).message}`],
      });
    } finally {
      setLoading(false);
    }
  }

  async function copyBody(s: LinkedInPostSuggestion, idx: number) {
    try {
      await navigator.clipboard.writeText(`${s.hook}\n\n${s.body}`);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((v) => (v === idx ? null : v)), 1500);
    } catch {
      /* clipboard indisponivel */
    }
  }

  function openInLinkedIn() {
    // LinkedIn nao tem intent URL rico pra pre-fillar post — abre feed
    // (user cola do clipboard).
    safeOpenUrl("https://www.linkedin.com/feed/");
  }

  return (
    <div class="flex min-h-full flex-col gap-3 p-3">
      <header class="flex items-center justify-between">
        <div class="min-w-0">
          <h2 class="text-sm font-semibold text-zinc-100">
            Posts LinkedIn — {workspace.name}
          </h2>
          <p class="mt-0.5 text-[10px] text-zinc-500">
            baseado nas ultimas replies LinkedIn postadas + pessoas-alvo da lista
          </p>
        </div>
        <button
          onClick={onClose}
          class="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          fechar
        </button>
      </header>

      <div class="rounded border border-indigo-500/30 bg-indigo-500/5 px-3 py-2 text-[11px] text-zinc-300">
        {result === null ? (
          <>
            clique abaixo pra rodar. vai buscar as{" "}
            <strong>ultimas 12 replies LinkedIn</strong> postadas + amostra de{" "}
            <strong>pessoas-alvo</strong> da lista ativa e sintetizar 5-10 posts com a
            voz LinkedIn <strong>{workspace.name}</strong>.
          </>
        ) : (
          <>
            analise atual feita em <strong>{(result.ms / 1000).toFixed(1)}s</strong>.
            {result.suggestions.length > 0
              ? " regerar? (custo ~$0.001)"
              : " sem sugestoes — cheque erros abaixo."}
          </>
        )}
      </div>

      <div class="flex items-center gap-2">
        <Button
          variant="primary"
          size="md"
          onClick={runSuggest}
          disabled={loading || !voice}
          title={
            !voice
              ? "configure voz LinkedIn antes (Settings > LinkedIn)"
              : "rodar analise"
          }
        >
          {loading ? "rodando..." : result ? "regerar analise" : "iniciar analise"}
        </Button>
        {!voice && (
          <span class="text-[10px] text-amber-300">
            ⚠ voz LinkedIn nao configurada
          </span>
        )}
      </div>

      {loading && (
        <div class="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-4 text-center text-xs text-zinc-400">
          buscando replies + pessoas-alvo + gerando sugestoes...
        </div>
      )}

      {result?.errors?.length ? (
        <div class="space-y-1">
          {result.errors.map((err, i) => (
            <div
              key={i}
              class="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300"
            >
              {err}
            </div>
          ))}
        </div>
      ) : null}

      {result && result.suggestions.length > 0 && (
        <div class="mb-2 flex flex-wrap gap-2 text-[10px] text-zinc-500">
          <span>
            <strong class="text-zinc-300">{result.recentReplies.length}</strong>{" "}
            replies usadas como base
          </span>
          {result.poiSample.length > 0 && (
            <span>
              ·{" "}
              <strong class="text-zinc-300">{result.poiSample.length}</strong>{" "}
              pessoas-alvo no contexto
            </span>
          )}
        </div>
      )}

      {result?.suggestions.map((s, idx) => (
        <article
          key={idx}
          class="rounded border border-zinc-800 bg-zinc-900/60 p-3"
        >
          <div class="mb-1.5 flex items-center gap-1.5">
            <span class="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-indigo-300">
              {s.category}
            </span>
            <span class="text-[10px] text-zinc-500">·</span>
            <span class="text-[10px] text-zinc-500">{s.angle}</span>
          </div>
          <h3 class="text-[13px] font-semibold text-zinc-100">{s.hook}</h3>
          <p
            class="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-zinc-300"
            style="overflow-wrap: anywhere"
          >
            {s.body}
          </p>
          {s.why && (
            <p class="mt-2 border-t border-zinc-800 pt-1.5 text-[10px] italic leading-relaxed text-zinc-500">
              {s.why}
            </p>
          )}
          <div class="mt-2 flex items-center justify-end gap-1.5">
            <button
              onClick={() => copyBody(s, idx)}
              class="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800"
            >
              {copiedIdx === idx ? "copiado" : "copiar"}
            </button>
            <button
              onClick={openInLinkedIn}
              class="rounded bg-indigo-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-indigo-500"
            >
              abrir LinkedIn
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
