// V5 — View LinkedIn (container).
//
// Estados:
//   idle       — mostra CTA "atualizar" + summary do bundle
//   loading    — spinner + step atual
//   triage     — lista de LinkedInPostCard com selecao
//   reply      — LinkedInReplyCard focado no post escolhido
//   posted     — flash de sucesso, volta pra triage
//   error      — banner com recovery
//
// UX: header sticky com back button + workspace name, para navegacao clara

import { useEffect, useRef, useState } from "preact/hooks";
import { getSession } from "../../../lib/auth";
import { runLinkedInTriage, type LinkedInTriageItem, type LinkedInTriageOutcome } from "../../../lib/channels/linkedin/orchestrator";
import { getApifyCostSummary, formatCostUsd, type ApifyCostSummary } from "../../../lib/channels/linkedin/cost";
import { getActiveBridges } from "../../../lib/groundswell/storage";
import { generateLinkedInReply } from "../../../lib/channels/linkedin/reply-generator";
import { supabase } from "../../../lib/supabase";
import type { PoiCandidate, RawPost } from "../../../lib/channels/types";
import type { Workspace } from "../../../lib/types";
import { LinkedInPostCard } from "./LinkedInPostCard";
import { LinkedInReplyCard } from "./LinkedInReplyCard";

interface Props {
  workspace: Workspace;
  onClose: () => void;
  userEmail?: string;
  /** V5.1: quando embedded, renderiza inline no main view (sem header proprio
   * — o Header principal do App cuida do title/atualizar). */
  embedded?: boolean;
  /** V5.1: trigger externo pra refresh. Cada mudanca de valor >0 dispara
   * handleRefresh interno. Wire pelo botao "atualizar" do Header principal. */
  refreshTrigger?: number;
  /** V5.3: chave APIFY do profile (opcional). Se presente, edge function
   *  usa em vez do secret server-side. */
  apifyToken?: string;
}

type ViewState =
  | { kind: "idle" }
  | { kind: "loading"; step: string }
  | { kind: "triage"; outcome: LinkedInTriageOutcome; toast?: string }
  | {
      kind: "reply";
      item: LinkedInTriageItem;
      replyText: string;
      selectedPoiId: string;
      strategyNote?: string;
      isGenerating: boolean;
      genError?: string;
    }
  | {
      // V5.0.3: analista postou no LinkedIn e agora cola URL do comment
      // pra registrar em posted_comment_urn. Skippable.
      kind: "awaiting_confirm";
      replyId: string;
      item: LinkedInTriageItem;
      replyText: string;
      poiName: string;
    }
  | { kind: "posted"; itemsLeft: number }
  | { kind: "error"; message: string };

interface DraftEntry {
  replyText: string;
  replyTextOriginal: string;
  selectedPoiId: string;
  strategyNote?: string;
}
interface SentEntry {
  replyText: string;
  wasEdited: boolean;
  sentAt: number;
  poiName: string;
}

export function LinkedInView({
  workspace,
  onClose,
  userEmail,
  embedded = false,
  refreshTrigger,
  apifyToken,
}: Props) {
  const [state, setState] = useState<ViewState>({ kind: "idle" });
  const [lastOutcome, setLastOutcome] = useState<LinkedInTriageOutcome | null>(
    null
  );
  // V5.1: cache local (em memoria — nao persiste entre remounts). Evita:
  // (1) regerar LLM se user volta pro mesmo post e (2) perder o texto
  // enviado ao voltar pra triage.
  const [drafts, setDrafts] = useState<Record<string, DraftEntry>>({});
  const [sent, setSent] = useState<Record<string, SentEntry>>({});
  // V5.1: custo APIFY visivel — atualizado no mount + apos cada refresh.
  const [cost, setCost] = useState<ApifyCostSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getApifyCostSummary(workspace.id).then((c) => {
      if (!cancelled) setCost(c);
    });
    return () => {
      cancelled = true;
    };
  }, [workspace.id, state.kind]);

  // V5.1: boot em MODO CACHE — le posts armazenados no store persistente
  // sem chamar APIFY. Se ha posts na janela, aparecem instant. Se store
  // vazio, empty state pede pra clicar "atualizar" (que chama APIFY).
  useEffect(() => {
    void handleRefresh({ mode: "cache" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, workspace.config.linkedin_bundle_id]);

  // V5.1: refreshTrigger externo (Header "atualizar") dispara APIFY refresh.
  // BUG fix: ao remontar (trocar canal e voltar), o App state preserva o
  // valor do tick — sem o ref abaixo, o effect trata "valor > 0 no mount"
  // como se fosse trigger novo e chamava APIFY desnecessariamente. Ref
  // ancora no valor visto no mount; so dispara em MUDANCA subsequente.
  const lastTriggerRef = useRef<number | undefined>(refreshTrigger);
  useEffect(() => {
    if (refreshTrigger === undefined) return;
    if (refreshTrigger === lastTriggerRef.current) return;
    lastTriggerRef.current = refreshTrigger;
    void handleRefresh({ mode: "refresh" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  async function handleRefresh(opts?: {
    bypassCache?: boolean;
    mode?: "cache" | "refresh";
  }) {
    const mode = opts?.mode ?? "refresh";
    setState({
      kind: "loading",
      step:
        mode === "cache"
          ? "carregando posts armazenados"
          : opts?.bypassCache
            ? "forcando coleta nova (ignora cache) — pode custar mais"
            : "buscando posts novos das conexoes",
    });
    try {
      const hours = workspace.config.linkedin_time_window_hours;
      const maxItems = workspace.config.linkedin_max_batch;
      const outcome = await runLinkedInTriage(workspace.id, {
        bundleId: workspace.config.linkedin_bundle_id,
        sinceMs:
          hours && hours > 0
            ? Date.now() - hours * 60 * 60 * 1000
            : undefined,
        maxItems: maxItems && maxItems > 0 ? maxItems : undefined,
        bypassCache: opts?.bypassCache,
        mode,
        apifyToken,
      });
      setLastOutcome(outcome);
      setState({ kind: "triage", outcome });
    } catch (e) {
      const err = e as Error & { detail?: string; status?: number };
      const parts: string[] = [err.message ?? "erro desconhecido"];
      if (err.detail) parts.push(err.detail);
      if (err.status) parts.push(`HTTP ${err.status}`);
      setState({
        kind: "error",
        message: parts.join(" — "),
      });
    }
  }

  function handleSelectPost(item: LinkedInTriageItem) {
    // V5.3.2: qualquer bridge pode gerar reply — mesmo sem POI candidate.
    // Antes bloqueava bundles Groundswell aqui e exigia POI; user relatou
    // que exporter novo raramente mapeia POI pra bridge, entao o bloqueio
    // impedia gerar reply pra 90%+ dos posts. Removido.
    // Se nao tem POI (poiCandidates vazio OU nenhum sugerido), o
    // reply-generator ja usa `buildLinkedInDirectSystemPrompt` (fluxo
    // "direto ao autor" — mesmo path das listas manuais).
    const firstPoi =
      item.suggestedPoi?.poi_id ?? item.poiCandidates[0]?.poi_id ?? null;
    // V5.1: se ja gerou draft neste post, reusa (nao chama LLM).
    const cached = drafts[item.post.post_ref];
    if (cached) {
      setState({
        kind: "reply",
        item,
        replyText: cached.replyText,
        selectedPoiId: cached.selectedPoiId,
        strategyNote: cached.strategyNote,
        isGenerating: false,
      });
      return;
    }
    setState({
      kind: "reply",
      item,
      replyText: "",
      selectedPoiId: firstPoi ?? "",
      isGenerating: true,
    });
    void generateForItem(item, firstPoi);
  }

  async function generateForItem(
    item: LinkedInTriageItem,
    poiId: string | null,
    keep_categories?: string[]
  ) {
    // V5.2: poiId=null (lista manual) â†’ passa poi=null pro reply-generator
    const poi = poiId
      ? item.poiCandidates.find((p) => p.poi_id === poiId) ?? null
      : null;
    if (poiId && !poi) return; // POI id passado mas nao achado — abort
    try {
      const result = await generateLinkedInReply({
        post: item.post,
        bridge: item.bridge,
        poi,
        bundleId: lastOutcome?.bundle.id ?? "",
        workspace: {
          linkedinVoice: workspace.config.linkedin_voice ?? "",
        },
        workspaceId: workspace.id,
        config: workspace.config,
        keep_categories,
      });
      // Escolhe a 1a reply — analista pode editar antes de postar
      const firstReply = result.replies[0];
      const generated = firstReply?.text ?? "";
      setState((prev) =>
        prev.kind === "reply"
          ? {
              ...prev,
              replyText: generated,
              strategyNote: result.strategy_note,
              isGenerating: false,
            }
          : prev
      );
      // V5.1: cachea draft por post_ref pra que ao voltar/reabrir esse post
      // reuse a geracao (sem chamar LLM novamente).
      setDrafts((prev) => ({
        ...prev,
        [item.post.post_ref]: {
          replyText: generated,
          replyTextOriginal: generated,
          selectedPoiId: poiId ?? "",
          strategyNote: result.strategy_note,
        },
      }));
    } catch (e) {
      // V5.0.3: erro fica inline no reply card — nao perde triage state
      setState((prev) =>
        prev.kind === "reply"
          ? {
              ...prev,
              isGenerating: false,
              genError: (e as Error).message ?? "erro gerando reply",
            }
          : prev
      );
    }
  }

  async function handlePoiSelect(poiId: string) {
    if (state.kind !== "reply") return;
    // V5.0.3: nao regera se ja e o POI ativo (mesmo clique)
    if (state.selectedPoiId === poiId) return;
    const item = state.item;
    setState({
      ...state,
      selectedPoiId: poiId,
      replyText: "",
      isGenerating: true,
      strategyNote: undefined,
      genError: undefined,
    });
    await generateForItem(item, poiId);
  }

  async function handleRegenerate() {
    if (state.kind !== "reply") return;
    setState({ ...state, isGenerating: true, replyText: "" });
    await generateForItem(state.item, state.selectedPoiId);
  }

  async function handlePost() {
    if (state.kind !== "reply") return;
    const { item, replyText, selectedPoiId, strategyNote } = state;
    // V5.3.2: bridges sem POI candidates (bundle novo raramente mapeia POI
    // pra conexao) tambem devem gravar reply e ir pro awaiting_confirm.
    // Antes: `if (!poi) return;` abortava silenciosamente, e user clicava
    // "postar" sem nada acontecer visualmente. Bug relatado. Fix: se nao
    // achou POI, poi=null; campos poi_target_* viram null no insert.
    const poi =
      item.poiCandidates.find((p) => p.poi_id === selectedPoiId) ?? null;
    // V5.1: was_edited = replyText final difere do original gerado pelo LLM.
    const draft = drafts[item.post.post_ref];
    const original = draft?.replyTextOriginal ?? replyText;
    const wasEdited = replyText.trim() !== original.trim();
    try {
      const session = await getSession();
      if (!session?.user) throw new Error("sem sessao");
      // V5.0.3: insere com decision='posted' + posted_at. posted_comment_urn
      // fica null aqui — analista completa no proximo step (awaiting_confirm).
      const { data: inserted, error: insErr } = await supabase
        .from("linkedin_replies")
        .insert({
          user_id: session.user.id,
          workspace_id: workspace.id,
          bundle_id: lastOutcome?.bundle.id,
          post_urn: item.post.post_ref,
          post_url: item.post.url,
          post_author_id: item.bridge.bridge_id,
          post_author_name: item.bridge.name,
          post_author_headline: item.bridge.headline,
          post_content: item.post.text,
          post_language: item.post.lang,
          bridge_id: item.bridge.bridge_id,
          bridge_readiness_tier: item.bridge.readiness_tier,
          poi_target_id: poi?.poi_id ?? null,
          poi_target_name: poi?.poi_name ?? null,
          relation_type_bridge_to_poi: poi?.relation_type ?? null,
          poi_selection_score: poi?.composite_score ?? null,
          strategy_note: strategyNote,
          reply_text: replyText,
          reply_text_original: original,
          was_edited: wasEdited,
          decision: "posted",
          posted_at: new Date().toISOString(),
          llm_provider: workspace.config.llm_provider,
        })
        .select("id")
        .single();
      if (insErr) throw insErr;
      await supabase.from("linkedin_engaged_posts").insert({
        user_id: session.user.id,
        workspace_id: workspace.id,
        post_urn: item.post.post_ref,
      });
      // V5.1: NAO remove da triage. Marca como enviado no cache local pra
      // que o card exiba o reply text abaixo do post — user pediu.
      setSent((prev) => ({
        ...prev,
        [item.post.post_ref]: {
          replyText,
          wasEdited,
          sentAt: Date.now(),
          poiName: poi?.poi_name ?? "",
        },
      }));
      setState({
        kind: "awaiting_confirm",
        replyId: (inserted as { id: string }).id,
        item,
        replyText,
        poiName: poi?.poi_name ?? "",
      });
    } catch (e) {
      setState({
        kind: "error",
        message: `salvar log falhou: ${(e as Error).message}`,
      });
    }
  }

  /** V5.0.3: analista cola URL do comentario postado no LinkedIn */
  async function handleConfirmUrl(url: string) {
    if (state.kind !== "awaiting_confirm") return;
    const commentUrn = extractCommentUrn(url);
    try {
      await supabase
        .from("linkedin_replies")
        .update({
          posted_comment_urn: commentUrn ?? url.trim(),
        })
        .eq("id", state.replyId);
    } catch (e) {
      console.warn("[linkedin] update posted_comment_urn falhou:", e);
    }
    finishAndReturnToTriage();
  }

  function handleSkipConfirmation() {
    if (state.kind !== "awaiting_confirm") return;
    finishAndReturnToTriage();
  }

  function finishAndReturnToTriage() {
    const itemsLeft = lastOutcome?.items.length ?? 0;
    setState({ kind: "posted", itemsLeft });
  }

  // V5.1: "voltar" agora preserva o draft (nao remove da triage nem descarta
  // o texto gerado). User pode reabrir o post e continuar de onde parou.
  function handleSkip() {
    if (state.kind !== "reply") return;
    if (lastOutcome) {
      setState({ kind: "triage", outcome: lastOutcome });
    }
  }

  // ============================================================================
  // Render
  // ============================================================================

  useEffect(() => {
    if (state.kind === "posted") {
      const t = setTimeout(() => {
        if (lastOutcome) {
          setState({ kind: "triage", outcome: lastOutcome });
        } else {
          setState({ kind: "idle" });
        }
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [state, lastOutcome]);

  return (
    <div class={embedded ? "flex flex-col" : "flex h-full flex-col"}>
      {!embedded && (
        <Header
          title="LinkedIn"
          subtitle={workspace.name}
          userEmail={userEmail}
          onClose={onClose}
          onBack={
            state.kind === "reply" && lastOutcome
              ? () => setState({ kind: "triage", outcome: lastOutcome })
              : undefined
          }
        />
      )}

      <div class={embedded ? "" : "flex-1 overflow-y-auto"}>
        {state.kind === "idle" && !embedded && (
          <IdleScreen onRefresh={handleRefresh} />
        )}
        {state.kind === "idle" && embedded && (
          <div class="py-10 text-center text-sm text-zinc-400">
            aperte <span class="text-sky-400">atualizar</span> pra puxar posts das conexoes.
          </div>
        )}
        {state.kind === "loading" && <LoadingScreen step={state.step} />}
        {state.kind === "triage" && (
          <TriageScreen
            outcome={state.outcome}
            onSelectPost={handleSelectPost}
            onRefresh={() => handleRefresh()}
            onForceRefresh={() => handleRefresh({ bypassCache: true })}
            toast={state.toast}
            drafts={drafts}
            sent={sent}
            cost={cost}
          />
        )}
        {state.kind === "reply" && (
          <div class="p-2">
            <ContextHeader item={state.item} />
            {state.genError && (
              <div
                role="alert"
                class="mb-2 rounded border border-amber-800/60 bg-amber-950/25 px-2.5 py-1.5 text-[11px] text-amber-200"
              >
                <div class="mb-0.5 font-semibold">falhou ao gerar reply</div>
                <div class="text-amber-100/85">{state.genError}</div>
              </div>
            )}
            <LinkedInReplyCard
              post={state.item.post}
              replyText={state.replyText}
              onReplyChange={(t) => {
                setState((prev) =>
                  prev.kind === "reply" ? { ...prev, replyText: t } : prev
                );
                // V5.1: mantem drafts em sync pra was_edited tracking
                setDrafts((prev) => {
                  const cur = prev[state.item.post.post_ref];
                  if (!cur) return prev;
                  return {
                    ...prev,
                    [state.item.post.post_ref]: { ...cur, replyText: t },
                  };
                });
              }}
              poiCandidates={state.item.poiCandidates}
              selectedPoiId={state.selectedPoiId}
              onPoiSelect={handlePoiSelect}
              onRegenerate={handleRegenerate}
              onPost={handlePost}
              onSkip={handleSkip}
              strategyNote={state.strategyNote}
              isGenerating={state.isGenerating}
              dailyLimitConfig={workspace.config.linkedin_daily_reply_limit}
            />
          </div>
        )}
        {state.kind === "awaiting_confirm" && (
          <ConfirmationScreen
            replyText={state.replyText}
            poiName={state.poiName}
            onConfirm={handleConfirmUrl}
            onSkip={handleSkipConfirmation}
          />
        )}
        {state.kind === "posted" && (
          <PostedFlash itemsLeft={state.itemsLeft} />
        )}
        {state.kind === "error" && (
          <ErrorScreen
            message={state.message}
            onRetry={() => setState({ kind: "idle" })}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Sub-screens
// ============================================================================

function Header({
  title,
  subtitle,
  userEmail,
  onClose,
  onBack,
}: {
  title: string;
  subtitle?: string;
  userEmail?: string;
  onClose: () => void;
  onBack?: () => void;
}) {
  return (
    <header class="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-zinc-800 bg-[color:var(--color-bg-base)]/95 px-3 py-2.5 backdrop-blur">
      <div class="flex min-w-0 items-center gap-1.5">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="voltar pra triage"
            class="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            ←
          </button>
        )}
        <div class="min-w-0">
          <h2 class="text-sm font-semibold text-zinc-200">{title}</h2>
          {subtitle && (
            <div class="truncate text-[11px] text-zinc-400">
              {subtitle}
              {userEmail && <span class="ml-1.5">· {userEmail}</span>}
            </div>
          )}
        </div>
      </div>
      <button
        onClick={onClose}
        aria-label="fechar canal LinkedIn"
        class="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
      >
        âœ•
      </button>
    </header>
  );
}

function IdleScreen({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div class="flex h-full items-center justify-center p-4">
      <div class="max-w-xs text-center">
        <p class="text-xs text-zinc-400">
          canal LinkedIn pronto pra uso.
        </p>
        <p class="mt-1 text-[11px] leading-snug text-zinc-400">
          atualizar traz posts recentes das conexoes prontas. reusa cache por 4h.
        </p>
        <button
          onClick={onRefresh}
          class="mt-3 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-1 focus:ring-offset-zinc-950"
        >
          atualizar
        </button>
      </div>
    </div>
  );
}

function LoadingScreen({ step }: { step: string }) {
  return (
    <div class="flex h-full items-center justify-center p-4">
      <div class="text-center">
        <div
          aria-hidden="true"
          class="mx-auto mb-2 h-4 w-4 animate-spin rounded-full border-2 border-sky-500 border-t-transparent"
        />
        <p class="text-xs text-zinc-300">{step}…</p>
      </div>
    </div>
  );
}

function TriageScreen({
  outcome,
  onSelectPost,
  onRefresh,
  onForceRefresh,
  toast,
  drafts,
  sent,
  cost,
}: {
  outcome: LinkedInTriageOutcome;
  onSelectPost: (item: LinkedInTriageItem) => void;
  onRefresh: () => void;
  onForceRefresh: () => void;
  toast?: string;
  drafts: Record<string, DraftEntry>;
  sent: Record<string, SentEntry>;
  cost: ApifyCostSummary | null;
}) {
  // V5.3.2: toggle "esconder respondidos". Default false (mostra tudo com
  // opacity), user pode ligar pra sumir os ja respondidos completamente.
  // Persiste em memoria da sessao (nao salva no storage).
  const [hideReplied, setHideReplied] = useState(false);
  if (outcome.items.length === 0) {
    const s = outcome.stats;
    // V5.1: diagnostico do porque zero — quebra do funnel visivel.
    const hasRaw = s.rawPosts > 0;
    const mostlyOld = hasRaw && s.filteredOld / s.rawPosts >= 0.5;
    return (
      <div class="p-3">
        <div class="rounded border border-zinc-800 bg-zinc-900/70 px-3 py-3">
          <p class="text-xs text-zinc-200 mb-1">
            nenhum post das conexoes passou pelo filtro.
          </p>
          <div class="mb-2 rounded border border-zinc-800 bg-zinc-950/50 p-2 font-mono text-[11px] leading-relaxed text-zinc-400">
            <div>coleta trouxe: <span class="text-zinc-200">{s.rawPosts} post(s)</span></div>
            <div>fora da janela ({s.windowHours}h) <span class="text-zinc-400">— cortados</span>: <span class="text-zinc-200">{s.filteredOld}</span></div>
            <div>republicacoes <span class="text-zinc-400">— mostradas com tag</span>: <span class="text-zinc-200">{s.filteredReposts}</span></div>
            <div>sem texto util <span class="text-zinc-400">— mostrados com tag</span>: <span class="text-zinc-200">{s.filteredNoText}</span></div>
            <div>ja comentados antes: <span class="text-zinc-200">{s.filteredEngaged}</span></div>
            <div class="mt-1 text-zinc-400">cache: {outcome.cached ? "reaproveitado (pode estar desatualizado)" : "coleta nova"}</div>
          </div>
          <p class="mb-2 text-[11px] leading-snug text-zinc-400">
            {!hasRaw && outcome.cached
              ? "coleta veio do cache com 0 posts (rodada anterior falhou/vazia). Clique 'forcar refresh' abaixo pra tentar de novo ignorando cache."
              : !hasRaw
                ? "coleta nao retornou posts. Verifica se as conexoes da lista tem perfis validos no LinkedIn."
                : mostlyOld
                  ? `A maioria dos posts e mais antiga que ${s.windowHours}h. Aumente a janela em Config > LinkedIn > Filtros + batch, ou clique 'forcar coleta nova' se o cache pode estar desatualizado.`
                  : "Ajuste os filtros em Config > LinkedIn."}
          </p>
          <div class="flex flex-wrap gap-1.5">
            <button
              onClick={onRefresh}
              class="rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-1 focus:ring-offset-zinc-950"
            >
              atualizar de novo
            </button>
            <button
              onClick={onForceRefresh}
              class="rounded border border-amber-700/60 bg-amber-950/20 px-2.5 py-1 text-[11px] text-amber-200 hover:bg-amber-900/30 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 focus:ring-offset-zinc-950"
              title="ignora o cache Apify de 72h — chama o actor novamente e gera nova cobrança."
            >
              forcar refresh (custa +)
            </button>
          </div>
          {/* V5.3.2: disclaimer trial APIFY. */}
          <p class="mt-1 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[11px] leading-snug text-amber-200/85">
            ðŸ’¡ Estamos em conta APIFY trial (credito limitado). Ideal: aguardar
            1-3 dias entre coletas — o cache de 72h ja segura as atualizacoes
            normais.
          </p>
          <BridgesInspector bundleId={outcome.bundle.id} />
        </div>
      </div>
    );
  }
  return (
    <div class="space-y-2 p-2">
      <TriageSummary outcome={outcome} onRefresh={onRefresh} cost={cost} />
      {toast && (
        <div
          role="status"
          class="rounded border border-amber-800/60 bg-amber-950/25 px-2.5 py-1.5 text-[11px] text-amber-200"
        >
          {toast}
        </div>
      )}
      {/* V5.3.2: filtro "esconder respondidos". Conta quantos ha e mostra
          toggle so quando faz sentido (nao mostra pra 0 respondidos). */}
      {(() => {
        const repliedCount = outcome.items.filter(
          (i) =>
            outcome.repliedPostUrns.has(i.post.post_ref) &&
            !sent[i.post.post_ref]
        ).length;
        if (repliedCount === 0) return null;
        return (
          <div class="flex items-center justify-between rounded border border-zinc-700 bg-zinc-900/70 px-2.5 py-1.5 text-[11px] text-zinc-300">
            <span>
              {repliedCount}{" "}
              {repliedCount === 1 ? "post já respondido" : "posts já respondidos"}
            </span>
            <button
              type="button"
              onClick={() => setHideReplied((v) => !v)}
              class={`rounded border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                hideReplied
                  ? "border-sky-500 bg-sky-500/15 text-sky-200"
                  : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              }`}
              aria-pressed={hideReplied}
            >
              {hideReplied ? "✓ escondendo" : "esconder"}
            </button>
          </div>
        );
      })()}
      {outcome.items.map((item) => {
        const draft = drafts[item.post.post_ref];
        const sentEntry = sent[item.post.post_ref];
        // V5.1: reply persistida em linkedin_replies (respondido em sessao anterior)
        const alreadyReplied = outcome.repliedPostUrns.has(item.post.post_ref);
        // V5.3.2: se toggle ligado, some completamente. sent na sessao atual
        // continua aparecendo (o user acabou de postar — quer ver o resultado).
        if (hideReplied && alreadyReplied && !sentEntry) return null;
        return (
          <div
            key={item.post.post_ref}
            class={`flex flex-col gap-1 ${alreadyReplied && !sentEntry ? "opacity-50 grayscale" : ""}`}
          >
            <LinkedInPostCard
              post={item.post}
              bridge={item.bridge}
              suggestedPoi={item.suggestedPoi ?? undefined}
              onOpen={() => onSelectPost(item)}
            />
            {/* V5.1: reply enviado NESTA sessao — badge verde + texto */}
            {sentEntry && (
              <div class="rounded border border-emerald-800/60 bg-emerald-950/25 px-2.5 py-1.5 text-[11px] leading-snug text-emerald-100/90">
                <div class="mb-0.5 flex items-baseline justify-between gap-2 text-[11px] uppercase tracking-wide text-emerald-400/80">
                  <span>
                    enviado {sentEntry.wasEdited ? "(editado)" : ""}
                  </span>
                  <span class="normal-case tracking-normal text-emerald-500/70">
                    para {sentEntry.poiName}
                  </span>
                </div>
                {sentEntry.replyText}
              </div>
            )}
            {/* V5.1: respondido em sessao anterior (persistente) — item vai
                pro fim da lista + zinc muted pra sinalizar "arquivado". */}
            {!sentEntry && alreadyReplied && (
              <div class="rounded border border-zinc-800 bg-zinc-950/60 px-2.5 py-1 text-[11px] leading-snug text-zinc-400">
                âœ“ ja respondido — consulte Historico
              </div>
            )}
            {/* V5.1: draft nao-enviado — badge neutro pra sinalizar que
                clicar reabre esse texto (sem chamar LLM). */}
            {!sentEntry && !alreadyReplied && draft && (
              <div class="rounded border border-sky-800/40 bg-sky-950/15 px-2.5 py-1 text-[11px] leading-snug text-sky-300/80">
                draft gerado — clique no post pra continuar
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// V5.1: expandivel com lista de bridges do bundle + URL LinkedIn clicavel.
// User usa pra conferir manualmente se bridges realmente postam pouco ou se
// ha bridge com perfil errado/privado.
interface BridgeInspectorRow {
  name: string;
  readiness_tier?: string;
  linkedin_url?: string;
  public_identifier?: string;
}

function BridgesInspector({ bundleId }: { bundleId: string }) {
  const [open, setOpen] = useState(false);
  const [bridges, setBridges] = useState<BridgeInspectorRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !bridges) {
      setLoading(true);
      try {
        const rows = await getActiveBridges(bundleId);
        setBridges(
          rows.map((b) => ({
            name: b.name ?? "sem nome",
            readiness_tier: b.readiness_tier,
            linkedin_url: b.linkedin_url,
            public_identifier: b.public_identifier,
          }))
        );
      } catch (e) {
        console.warn("[bridges-inspector] falhou:", e);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div class="mt-2">
      <button
        type="button"
        onClick={toggle}
        class="text-[11px] text-sky-400 underline underline-offset-2 hover:text-sky-300"
      >
        {open ? "â–¾ esconder conexoes" : "â–¸ ver conexoes da lista (verificar postagens)"}
      </button>
      {open && (
        <div class="mt-1.5 rounded border border-zinc-800 bg-zinc-950/50 p-2">
          {loading && <div class="text-[11px] text-zinc-400">carregando...</div>}
          {!loading && bridges && bridges.length === 0 && (
            <div class="text-[11px] text-zinc-400">nenhuma conexao pronta na lista.</div>
          )}
          {!loading && bridges && bridges.length > 0 && (
            <>
              <div class="mb-1 text-[11px] text-zinc-400">
                {bridges.length} conexao(oes). Clique pra abrir perfil no LinkedIn.
              </div>
              <ul class="flex flex-col gap-0.5 font-mono text-[11px]">
                {bridges.map((b) => {
                  const url =
                    b.linkedin_url ??
                    (b.public_identifier
                      ? `https://www.linkedin.com/in/${b.public_identifier}`
                      : undefined);
                  return (
                    <li
                      key={b.public_identifier ?? b.name}
                      class="flex items-center justify-between gap-2 border-b border-zinc-700 py-0.5 last:border-0"
                    >
                      <span class="truncate text-zinc-300">{b.name}</span>
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="shrink-0 text-sky-400 hover:text-sky-300"
                          title={url}
                        >
                          {b.public_identifier ?? "abrir â†—"}
                        </a>
                      ) : (
                        <span class="shrink-0 text-red-400" title="sem URL LinkedIn no bundle">
                          sem url
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TriageSummary({
  outcome,
  onRefresh,
  cost,
}: {
  outcome: LinkedInTriageOutcome;
  onRefresh: () => void;
  cost: ApifyCostSummary | null;
}) {
  // V5.1: alerta se custo mensal APIFY ja passou de $50 (~limite plano free)
  const monthWarn = cost ? cost.cost_month >= 50 : false;
  const monthAlarm = cost ? cost.cost_month >= 80 : false;
  const monthCls = monthAlarm
    ? "text-red-300"
    : monthWarn
      ? "text-amber-300"
      : "text-zinc-400";
  // V5.2: colapsavel. Header sempre compacto (nao ocupa espaco), detalhes
  // de custo APIFY expandem sob demanda. Botao refresh + counter permanecem
  // sempre visiveis pra manter as acoes rapidas.
  return (
    <details class="group rounded border border-zinc-800 bg-zinc-900/60">
      <summary class="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-1.5 [&::-webkit-details-marker]:hidden">
        <div class="flex min-w-0 items-center gap-1.5">
          <span
            class="inline-block w-2 shrink-0 text-zinc-400 transition-transform group-open:rotate-90"
            aria-hidden="true"
          >
            ›
          </span>
          <div class="min-w-0">
            <div class="text-[11px] font-medium text-zinc-200">
              {outcome.items.length} posts pra revisar
            </div>
            <div class="text-[11px] text-zinc-400">
              {outcome.cached ? "reaproveitado · $0.00" : `coleta nova · $${outcome.cost.usd.toFixed(2)}`}
            </div>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRefresh();
          }}
          aria-label="atualizar posts"
          class="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-1 focus:ring-offset-zinc-950"
        >
          ↻
        </button>
      </summary>
      {cost && (
        <div class="border-t border-zinc-800 px-2.5 py-1.5 text-right font-mono text-[11px] tabular-nums leading-tight">
          <div class="text-zinc-400">
            hoje: <span class="text-zinc-300">{formatCostUsd(cost.cost_today)}</span>
            {" · "}
            <span class="text-zinc-400">{cost.runs_today} runs</span>
          </div>
          <div class="text-zinc-400">
            mes: <span class={monthCls}>{formatCostUsd(cost.cost_month)}</span>
            {" · "}
            <span class="text-zinc-400">{cost.runs_month} runs</span>
            {cost.runs_cached_month > 0 && (
              <span class="text-emerald-400">
                {" "}({cost.runs_cached_month} cache)
              </span>
            )}
          </div>
        </div>
      )}
      {/* V5.3.2: disclaimer sobre cadencia ideal de refresh. Contas APIFY
          trial tem credito limitado — cada coleta full custa ~$0.40. Cache
          de 72h cobre a maioria dos casos sem re-coletar. */}
      <div class="border-t border-zinc-800 bg-amber-500/5 px-2.5 py-1.5 text-[11px] leading-snug text-amber-200/90">
        ðŸ’¡ <strong>refresh ideal:</strong> a cada 1-3 dias. Estamos em conta
        APIFY trial (crédito limitado) — o cache de 72h ja segura a maioria
        das atualizacoes. Só clique <span class="font-mono">"forçar refresh"</span>{" "}
        quando precisar mesmo de posts do dia.
      </div>
    </details>
  );
}

function ContextHeader({ item }: { item: LinkedInTriageItem }) {
  const bridge = item.bridge;
  return (
    <div class="mb-2 rounded border border-zinc-800 bg-zinc-900/70 px-2.5 py-1.5">
      <div class="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">
        respondendo
      </div>
      <div class="truncate text-xs font-medium text-zinc-100">{bridge.name}</div>
      {bridge.headline && (
        <div class="truncate text-[11px] text-zinc-400">{bridge.headline}</div>
      )}
      <p class="mt-1.5 line-clamp-3 whitespace-pre-wrap text-[11px] leading-snug text-zinc-400">
        {item.post.text}
      </p>
    </div>
  );
}

/**
 * V5.0.3: extrai commentUrn de uma URL LinkedIn de comment.
 * Formatos suportados:
 *   - https://www.linkedin.com/feed/update/urn:li:activity:XXX?commentUrn=urn:li:comment:...
 *   - urn:li:comment:(activity:XXX,YYYYYY)  (colado direto)
 *   - qualquer URL contendo "activity:NUMEROS" — extrai como fallback
 */
function extractCommentUrn(input: string): string | null {
  const clean = input.trim();
  if (!clean) return null;

  // 1. URL contendo commentUrn=urn:li:comment:...
  const commentUrnMatch = clean.match(
    /commentUrn=(urn(?:%3A|:)li(?:%3A|:)comment(?:%3A|:)[^&\s]+)/i
  );
  if (commentUrnMatch) {
    try {
      return decodeURIComponent(commentUrnMatch[1]);
    } catch {
      return commentUrnMatch[1];
    }
  }

  // 2. Colou o URN direto
  if (/^urn:li:comment:/i.test(clean)) return clean;

  // 3. Fallback: activity URN da URL
  const activityMatch = clean.match(/activity[:%-]?(\d{10,})/i);
  if (activityMatch) {
    return `urn:li:activity:${activityMatch[1]}`;
  }

  return null;
}

function ConfirmationScreen({
  replyText,
  poiName,
  onConfirm,
  onSkip,
}: {
  replyText: string;
  poiName: string;
  onConfirm: (url: string) => void;
  onSkip: () => void;
}) {
  const [urlInput, setUrlInput] = useState("");
  const [previewUrn, setPreviewUrn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function handleUrlChange(v: string) {
    setUrlInput(v);
    setPreviewUrn(extractCommentUrn(v));
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm(urlInput);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="p-2">
      <div class="rounded border border-emerald-800/60 bg-emerald-950/25 px-3 py-2.5">
        <div class="mb-2 flex items-center gap-2">
          <span
            aria-hidden="true"
            class="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white"
          >
            âœ“
          </span>
          <div class="text-xs font-semibold text-emerald-200">
            reply copiada + post aberto
          </div>
        </div>
        <p class="text-[11px] leading-snug text-emerald-100/80">
          cola a reply no LinkedIn, publica, depois copia o link do teu
          comentario e cola aqui pra rastrear engagement
          {poiName ? (
            <> do <span class="font-semibold">{poiName}</span></>
          ) : (
            ""
          )}.
        </p>
      </div>

      <details class="mt-2 rounded border border-zinc-800 bg-zinc-900/50 px-2.5 py-1.5">
        <summary class="cursor-pointer list-none text-[11px] uppercase tracking-wide text-zinc-400 [&::-webkit-details-marker]:hidden">
          ver reply que voce postou
        </summary>
        <p class="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-400">
          {replyText}
        </p>
      </details>

      <div class="mt-3">
        <label
          for="lni-confirm-url"
          class="mb-1 flex items-baseline justify-between text-xs font-medium text-zinc-300"
        >
          <span>
            URL ou URN do comentario <span class="text-zinc-400">(opcional)</span>
          </span>
        </label>
        <input
          id="lni-confirm-url"
          type="text"
          value={urlInput}
          onInput={(e) =>
            handleUrlChange((e.target as HTMLInputElement).value)
          }
          placeholder="cola aqui pra rastrear"
          class="w-full rounded border border-zinc-700 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-500 focus:ring-offset-1 focus:ring-offset-zinc-900"
        />
        <p
          class={`mt-1 font-mono text-[11px] tabular-nums ${
            previewUrn ? "text-emerald-400" : "text-zinc-400"
          }`}
          aria-live="polite"
        >
          {urlInput.trim() === ""
            ? "cola o link do comentario postado — extrai o URN automaticamente"
            : previewUrn
            ? `URN: ${previewUrn.slice(0, 60)}${previewUrn.length > 60 ? "…" : ""}`
            : "nao consegui identificar URN — sera salvo como texto bruto"}
        </p>
      </div>

      <div class="mt-3 flex items-center justify-end gap-1.5">
        <button
          onClick={onSkip}
          disabled={busy}
          class="rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-1 focus:ring-offset-zinc-900"
        >
          pular
        </button>
        <button
          onClick={submit}
          disabled={busy || urlInput.trim().length === 0}
          class="rounded bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-1 focus:ring-offset-zinc-900"
        >
          {busy ? "salvando…" : "confirmar"}
        </button>
      </div>
    </div>
  );
}

function PostedFlash({ itemsLeft }: { itemsLeft: number }) {
  return (
    <div class="flex h-full items-center justify-center p-4">
      <div class="text-center">
        <div
          aria-hidden="true"
          class="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white"
        >
          âœ“
        </div>
        <p class="text-xs text-emerald-300">reply logada</p>
        <p class="mt-0.5 text-[11px] text-zinc-400">
          {itemsLeft > 0
            ? `voltando pra triage (${itemsLeft} restam)`
            : "triage vazia — atualiza pra buscar mais"}
        </p>
      </div>
    </div>
  );
}

function ErrorScreen({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div class="p-3">
      <div
        role="alert"
        class="rounded border border-red-800/60 bg-red-950/30 px-3 py-2.5"
      >
        <div class="mb-1.5 text-[11px] font-semibold text-red-200">
          erro no canal LinkedIn
        </div>
        <p class="mb-2 text-xs leading-relaxed text-red-100/85">{message}</p>
        <button
          onClick={onRetry}
          class="rounded border border-red-700 bg-red-900/40 px-2 py-1 text-[11px] font-medium text-red-100 hover:bg-red-800/60 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-red-950"
        >
          tentar de novo
        </button>
      </div>
    </div>
  );
}

// export helper — permite RawPost import lateral se necessario em outros consumidores
export type { RawPost, PoiCandidate };


