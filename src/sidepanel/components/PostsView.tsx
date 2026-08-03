import { useEffect, useRef, useState } from "preact/hooks";
import { clearGeminiImageCache } from "../../lib/gemini-image";
import {
  suggestPosts,
  type PostsSuggestionResult,
  type PostSuggestion,
  type PostsSuggestionMode,
} from "../../lib/posts-suggestion";
import { safeOpenUrl } from "../../lib/safe-url";
import { pushPostLog } from "../../lib/sync";
import type { Workspace, WorkspaceMeta } from "../../lib/types";
import { Button } from "../ui/Button";
import { PostConfirmFlow } from "./PostConfirmFlow";

interface Props {
  workspace: Workspace;
  workspaces: WorkspaceMeta[];
  onSwitchWorkspace: (id: string) => void;
  onClose: () => void;
  // V4.1.8: state controlado pelo App.tsx — close/reopen mantem ultimo result
  result: PostsSuggestionResult | null;
  setResult: (r: PostsSuggestionResult | null) => void;
  // V4.1.8: data especifica do Watchtower (default = hoje, null = auto-match)
  watchtowerDate: string | null;
  setWatchtowerDate: (d: string | null) => void;
  // V4.1.8: pra logar post no Supabase
  userEmail: string | null;
}

// V4.1.7 — Aba Posts. Watchtower via Edge Function proxy (token Notion
// server-side, zero exposicao client).
// V4.1.8 — State lifted pro App.tsx pra preservar entre close/open.
export function PostsView({
  workspace,
  workspaces,
  onSwitchWorkspace,
  onClose,
  result,
  setResult,
  watchtowerDate,
  setWatchtowerDate,
  userEmail,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  // V5.2: modo de sugestao — hybrid default. Chip selector no topo.
  const [mode, setMode] = useState<PostsSuggestionMode>("hybrid");
  // V4.1.14 (IN-05): handle pra limpar timer no unmount evita setState
  // depois do componente sair (Preact warn de "setState on unmounted").
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);
  const voice = workspace.config.voice?.trim() ?? "";
  // V4.1.8: pendingPost = sugestao clicada pra "abrir no X" aguardando
  // confirmacao no dialog (analista volta apos postar)
  const [pendingPost, setPendingPost] = useState<{
    suggestion: PostSuggestion;
    clickedAt: number;
  } | null>(null);

  async function runSuggest() {
    setLoading(true);
    clearGeminiImageCache();
    try {
      const out = await suggestPosts(workspace, {
        watchtowerDate: watchtowerDate ?? undefined,
        mode,
      });
      setResult(out);
    } catch (e) {
      setResult({
        suggestions: [],
        viralPosts: [],
        recentReplyCategories: [],
        mode,
        ms: 0,
        errors: [`Erro inesperado: ${(e as Error).message}`],
      });
    } finally {
      setLoading(false);
    }
  }

  async function copyToClipboard(text: string, idx: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedIdx(null), 1500);
    } catch {
      /* fallback se clipboard nao disponivel */
    }
  }

  function openInX(suggestion: PostSuggestion) {
    const url = `https://x.com/intent/post?text=${encodeURIComponent(
      suggestion.body
    )}`;
    // V4.1.14 (CR-05): valida scheme + host antes de abrir tab
    safeOpenUrl(url);
    // V4.1.8: marca pendingPost — abre dialog de confirmacao quando volta
    setPendingPost({ suggestion, clickedAt: Date.now() });
  }

  // V4.1.8: registra post (postado ou skipped) no Supabase post_logs
  async function logPost(
    suggestion: PostSuggestion,
    clickedAt: number,
    decision: "posted" | "skipped",
    finalBody?: string,
    postedPostId?: string | null
  ) {
    if (!userEmail) return;
    const wasEdited = finalBody !== undefined && finalBody !== suggestion.body;
    try {
      await pushPostLog({
        user_email: userEmail,
        workspace_id: workspace.id,
        workspace_name: workspace.name,
        voice_snapshot: workspace.config.voice ?? null,
        angle: suggestion.angle,
        hook: suggestion.hook ?? null,
        body: finalBody ?? suggestion.body,
        why: suggestion.why ?? null,
        category: suggestion.category ?? null,
        image_model: suggestion.image?.modelUsed ?? null,
        image_mime_type: suggestion.image?.mimeType ?? null,
        // V4.1.14 (CR-04): NAO grava data URL no banco — 200KB-1MB por post
        // estoura quota Supabase rapido. Imagem vive so no client (postsResult).
        image_data_url: null,
        watchtower_title: result?.watchtower?.title ?? null,
        watchtower_matched_by: result?.watchtower?.matched_by ?? null,
        watchtower_date_requested: watchtowerDate ?? null,
        viral_posts_count: result?.viralPosts?.length ?? null,
        recent_categories: result?.recentReplyCategories ?? null,
        was_edited: wasEdited,
        posted_at: decision === "posted" ? new Date().toISOString() : null,
        posted_post_id: decision === "posted" ? (postedPostId ?? null) : null,
        decision,
        time_to_decide_ms: Date.now() - clickedAt,
      });
    } catch (e) {
      console.warn("[posts] pushPostLog falhou:", e);
    }
  }

  async function handlePostConfirmed(data: {
    finalBody: string;
    postedPostId: string | null;
    wasEditedInDialog: boolean;
  }) {
    if (!pendingPost) return;
    await logPost(
      pendingPost.suggestion,
      pendingPost.clickedAt,
      "posted",
      data.finalBody,
      data.postedPostId
    );
    setPendingPost(null);
  }

  async function handlePostSkipped() {
    if (!pendingPost) return;
    await logPost(pendingPost.suggestion, pendingPost.clickedAt, "skipped");
    setPendingPost(null);
  }

  // V4.1.6: baixa imagem Gemini gerada (data URL base64) como arquivo PNG
  // que o analista anexa manualmente ao post no X.
  function downloadImage(
    image: { dataUrl: string; mimeType: string },
    idx: number
  ) {
    const a = document.createElement("a");
    a.href = image.dataUrl;
    const ext = image.mimeType.split("/")[1] ?? "png";
    a.download = `replai-post-${Date.now()}-${idx}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setCopiedIdx(idx + 1000);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedIdx(null), 1500);
  }

  return (
    <div class="flex min-h-screen flex-col">
      {/* HEADER sticky com switcher de persona + acoes */}
      <div class="sticky top-0 z-10 border-b border-zinc-800 bg-[color:var(--color-bg-base)]/95 px-3 py-2.5 backdrop-blur">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <h2 class="text-sm font-bold text-zinc-100">posts</h2>
            <p class="truncate text-[11px] text-zinc-500">
              sugestoes baseadas em Watchtower + virais + tua persona
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            fechar
          </Button>
        </div>

        {/* dropdown de persona (workspace) */}
        {workspaces.length > 1 && (
          <div class="mt-2 flex items-center gap-1.5">
            <span class="shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">
              persona
            </span>
            <select
              value={workspace.id}
              onChange={(e) => {
                const id = (e.target as HTMLSelectElement).value;
                if (id !== workspace.id) {
                  onSwitchWorkspace(id);
                  // limpa result ao trocar persona — proxima analise gera nova
                  setResult(null);
                }
              }}
              class="min-w-0 flex-1 truncate rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-sky-500"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div class="flex flex-col gap-3 p-3">
        {/* CTA INICIAR / REGERAR + DATE PICKER WATCHTOWER */}
        <div class="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
          <div class="mb-2 text-[11px] leading-snug text-zinc-300">
            {!result ? (
              <>
                clique abaixo pra rodar a analise. vai buscar o{" "}
                <strong>Watchtower</strong> do dia + os <strong>15 virais</strong>{" "}
                mais engajados da Lista ativa nas ultimas 24h + tuas{" "}
                <strong>categorias recentes</strong> e mandar pro LLM cross-referenciar
                com a voz <strong>{workspace.name}</strong>.
              </>
            ) : (
              <>
                analise atual feita em <strong>{(result.ms / 1000).toFixed(1)}s</strong>.
                quer rodar de novo (custo ~$0.002)?
              </>
            )}
          </div>

          {/* V5.2: mode selector — 3 chips lado a lado */}
          <div class="mb-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span class="text-zinc-500">modo:</span>
            {(
              [
                { key: "watchtower", label: "Watchtower", tip: "so Watchtower + virais (V4.1)" },
                { key: "replies_synthesis", label: "Replies", tip: "sintese das ultimas replies (novo)" },
                { key: "hybrid", label: "Hibrido", tip: "mescla os dois — default" },
              ] as const
            ).map(({ key, label, tip }) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                title={tip}
                aria-pressed={mode === key}
                class={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                  mode === key
                    ? "border-sky-500/40 bg-sky-500/15 text-sky-200"
                    : "border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* V4.1.8: date picker pro Watchtower (default = hoje) */}
          <div class="mb-2 flex items-center gap-2 text-[11px]">
            <label class="text-zinc-400">data do Watchtower:</label>
            <input
              type="date"
              value={watchtowerDate ?? ""}
              onInput={(e) =>
                setWatchtowerDate(
                  (e.target as HTMLInputElement).value || null
                )
              }
              class="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200 outline-none focus:border-sky-500"
            />
            {watchtowerDate && (
              <button
                type="button"
                onClick={() => setWatchtowerDate(null)}
                class="text-[10px] text-zinc-500 hover:text-zinc-300"
                title="voltar pra hoje"
              >
                ✕ limpar
              </button>
            )}
            <span class="text-[10px] text-zinc-500">
              {watchtowerDate ? "" : "(vazio = hoje)"}
            </span>
          </div>

          <div class="flex items-center gap-2">
            <Button
              variant="primary"
              size="md"
              onClick={runSuggest}
              disabled={loading || !voice}
              title={
                !voice
                  ? "configure a voz do workspace antes (Settings)"
                  : "rodar analise (Notion + virais + LLM)"
              }
            >
              {loading
                ? "rodando..."
                : result
                  ? "regerar analise"
                  : "iniciar analise"}
            </Button>
            {!voice && (
              <span class="text-[10px] text-amber-300">
                ⚠ workspace sem voz — configure em Settings primeiro
              </span>
            )}
          </div>
        </div>

        {/* LOADING STATE com indicacao das etapas */}
        {loading && (
          <div class="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <div class="mb-2 flex items-center gap-2">
              <div class="h-3 w-3 animate-pulse rounded-full bg-sky-500"></div>
              <span class="text-sm text-zinc-200">rodando analise...</span>
            </div>
            <ul class="ml-5 list-disc text-[11px] text-zinc-500">
              <li>buscando Watchtower de hoje no Notion</li>
              <li>puxando 15 virais da Lista ativa (24h)</li>
              <li>consultando suas categorias recentes no Supabase</li>
              <li>Gemini Flash cross-referenciando com a voz da persona</li>
            </ul>
            <p class="mt-2 text-[10px] text-zinc-500">
              latencia esperada ~5-15s
            </p>
          </div>
        )}

        {/* WARNINGS (configs faltando) */}
        {!loading && result && result.errors.length > 0 && (
          <div class="rounded border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] text-amber-200">
            <div class="mb-1 font-semibold">avisos:</div>
            <ul class="ml-4 list-disc">
              {result.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        {/* META DAS FONTES */}
        {!loading && result && (
          <div class="grid grid-cols-3 gap-1.5 text-[10px]">
            <div
              class={`rounded px-2 py-1 ${result.watchtower ? "bg-emerald-500/10 text-emerald-300" : "bg-zinc-800/60 text-zinc-500"}`}
              title={
                result.watchtower
                  ? `Watchtower de ${result.watchtower.title} (matched_by=${result.watchtower.matched_by})`
                  : "Watchtower nao carregado"
              }
            >
              Watchtower:{" "}
              {result.watchtower
                ? `✓ ${result.watchtower.title.slice(0, 20)}`
                : "—"}
            </div>
            <div class="rounded bg-zinc-800/60 px-2 py-1 text-zinc-300">
              virals: {result.viralPosts.length}
            </div>
            <div class="rounded bg-zinc-800/60 px-2 py-1 text-zinc-300">
              top categorias:{" "}
              {result.recentReplyCategories.slice(0, 3).join(", ") || "—"}
            </div>
          </div>
        )}

        {/* SUGESTOES */}
        {!loading && result?.suggestions && result.suggestions.length > 0 && (
          <div class="flex flex-col gap-2">
            {result.suggestions.map((s, idx) => {
              const charCount = s.body.length;
              const overLimit = charCount > 280;
              return (
                <article
                  key={idx}
                  class="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5"
                >
                  <div class="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span class="rounded bg-violet-500/15 px-1.5 py-0.5 font-medium text-violet-300">
                      {s.angle}
                    </span>
                    <span class="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300">
                      {s.category}
                    </span>
                  </div>
                  <p class="mb-1.5 text-[13px] font-semibold leading-snug text-zinc-100">
                    {s.hook}
                  </p>
                  <p class="mb-2 whitespace-pre-wrap text-[13px] leading-snug text-zinc-300">
                    {s.body}
                  </p>
                  {/* V4.1.6: imagem gerada via Gemini (mesmo prompt orientado
                      a estilo editorial pra evitar AI-look) */}
                  {s.image && (
                    <div class="mb-2 overflow-hidden rounded border border-zinc-800">
                      <img
                        src={s.image.dataUrl}
                        alt={`imagem gerada pra ${s.angle}`}
                        class="h-40 w-full object-cover"
                        loading="lazy"
                      />
                      <div class="flex items-center justify-between bg-zinc-950 px-2 py-1 text-[10px] text-zinc-500">
                        <span>imagem gerada (Gemini)</span>
                        <button
                          type="button"
                          onClick={() => downloadImage(s.image!, idx)}
                          class="text-zinc-400 hover:text-zinc-200"
                        >
                          {copiedIdx === idx + 1000
                            ? "baixada!"
                            : "baixar imagem"}
                        </button>
                      </div>
                    </div>
                  )}
                  <p class="mb-2 text-[10px] italic text-zinc-500">
                    why: {s.why}
                  </p>
                  <div class="flex items-center justify-between">
                    <span
                      class={`text-[10px] tabular-nums ${overLimit ? "text-red-400" : "text-zinc-500"}`}
                    >
                      {charCount}/280
                    </span>
                    <div class="flex gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(s.body, idx)}
                      >
                        {copiedIdx === idx ? "copiado!" : "copiar"}
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => openInX(s)}
                      >
                        abrir no X
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* SEM SUGESTOES POREM SEM ERRO */}
        {!loading &&
          result &&
          result.suggestions.length === 0 &&
          result.errors.length === 0 && (
            <div class="rounded border border-zinc-800 bg-zinc-900/50 p-4 text-center text-sm text-zinc-400">
              nenhuma sugestao gerada.
              <br />
              <span class="text-[11px] text-zinc-500">
                tenta de novo — pode ter sido limite de tokens do LLM.
              </span>
            </div>
          )}

        {/* DETAILS: VIRAL POSTS REFERENCE */}
        {!loading && result && result.viralPosts.length > 0 && (
          <details class="rounded border border-zinc-800 bg-zinc-900/30">
            <summary class="cursor-pointer px-2.5 py-2 text-[11px] text-zinc-400 hover:text-zinc-200">
              <span aria-hidden="true">▸</span> viral posts usados como input ({result.viralPosts.length})
            </summary>
            <div class="border-t border-zinc-800 p-2 text-[11px]">
              {result.viralPosts.slice(0, 10).map((v, i) => (
                <div key={i} class="mb-1.5 rounded bg-zinc-950 p-1.5">
                  <div class="text-[10px] text-zinc-500">
                    @{v.handle} • ❤️ {v.likes} ↺ {v.retweets} 💬 {v.replies}
                  </div>
                  <div class="text-zinc-300">
                    {v.text.length > 200
                      ? `${v.text.slice(0, 200)}...`
                      : v.text}
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* DETAILS: WATCHTOWER PREVIEW */}
        {!loading && result?.watchtower && (
          <details class="rounded border border-zinc-800 bg-zinc-900/30">
            <summary class="cursor-pointer px-2.5 py-2 text-[11px] text-zinc-400 hover:text-zinc-200">
              <span aria-hidden="true">▸</span> Watchtower bruto: {result.watchtower.title}
            </summary>
            <div class="border-t border-zinc-800 p-2 text-[11px] text-zinc-300">
              <pre class="max-h-60 overflow-y-auto whitespace-pre-wrap font-sans">
                {result.watchtower.text}
              </pre>
              {result.watchtower.viralText && (
                <>
                  <div class="my-2 border-t border-zinc-800"></div>
                  <div class="text-[10px] uppercase tracking-wide text-emerald-300">
                    viral posts (subpagina)
                  </div>
                  <pre class="max-h-60 overflow-y-auto whitespace-pre-wrap font-sans">
                    {result.watchtower.viralText}
                  </pre>
                </>
              )}
            </div>
          </details>
        )}
      </div>

      {/* V4.1.8: dialog de confirmacao do post + URL */}
      {pendingPost && (
        <PostConfirmFlow
          open
          angle={pendingPost.suggestion.angle}
          category={pendingPost.suggestion.category}
          originalBody={pendingPost.suggestion.body}
          onConfirmPosted={handlePostConfirmed}
          onSkipped={handlePostSkipped}
          onClose={() => setPendingPost(null)}
        />
      )}
    </div>
  );
}
