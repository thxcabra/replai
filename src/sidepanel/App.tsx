import { useEffect, useState } from "preact/hooks";
import { isAdmin as checkIsAdmin } from "../lib/admin";
import { getSession, onAuthChange, signOut } from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";
import type { ProfileRow } from "../lib/supabase-types";
import {
  clearSessionCache,
  createWorkspace,
  deleteWorkspace,
  exportWorkspace,
  getActiveWorkspace,
  getProfileCache,
  getRepliedIds,
  getSessionCache,
  getSetupSeen,
  getWorkspace,
  importWorkspace,
  isConfigComplete,
  listWorkspaces,
  markSetupSeen,
  onSyncError,
  pullAll,
  renameWorkspace,
  saveSessionCache,
  saveWorkspace,
  setActiveWorkspaceId,
  setReplied,
  updateProfile,
} from "../lib/storage";
import {
  generateRepliesForSelected,
  runQuickTest,
  runTriage,
} from "../lib/orchestrator";
import { ApiError } from "../lib/errors";
import { track } from "../lib/metrics";
import {
  bumpClicked,
  bumpPosted,
  bumpSkipped,
  type SessionId,
} from "../lib/session-tracking";
import { extractAllTweetMeta } from "../lib/tweet-meta";
import { getVoiceVersionIdByText } from "../lib/voice-versions";
import type {
  Config,
  EnrichedTweet,
  RawTweet,
  RenderedTweet,
  SortBy,
  Workspace,
  WorkspaceMeta,
} from "../lib/types";
import { AdminPanel } from "./components/AdminPanel";
import { Dashboard } from "./components/Dashboard";
import { Header } from "./components/Header";
import { PostConfirmDialog } from "./components/PostConfirmDialog";
import { Settings } from "./components/Settings";
import { SetupWizard } from "./components/SetupWizard";
import { TriageView, type TriageMode } from "./components/TriageView";
import { TweetCard } from "./components/TweetCard";

interface LastRefresh {
  collected: number;
  passed: number;
  ts: number;
}

export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceMeta[]>([]);
  const [view, setView] = useState<
    "main" | "settings" | "dashboard" | "triage" | "admin"
  >("main");
  const [isAdmin, setIsAdmin] = useState(false);
  // Queue de triagem pos-fetch + pre-LLM. Estado em-memoria; se navegar fora,
  // perde (mas o fetch da TwitterAPI ja rodou, nao queima de novo).
  const [triageQueue, setTriageQueue] = useState<EnrichedTweet[]>([]);
  const [triageMessage, setTriageMessage] = useState<string | undefined>(
    undefined
  );
  // Preferencia local do analista (list vs swipe). Persiste por device.
  const [triageMode, setTriageMode] = useState<TriageMode>("swipe");
  // Quando o LLM gerou as replies, guardamos o timestamp pra calcular
  // time_to_decide_ms em cada reply log.
  const [repliesGeneratedAt, setRepliesGeneratedAt] = useState<number | null>(
    null
  );
  // Sessao atual (id em session_logs) e usage do LLM da chamada que gerou as
  // replies atuais. Sao threaded em pushReplyLog (reply_logs.session_id +
  // llm_input_tokens/cost_usd) e em bumpSession (replies_clicked/posted/skipped).
  const [currentSessionId, setCurrentSessionId] = useState<SessionId>(null);
  const [currentLlmUsage, setCurrentLlmUsage] = useState<{
    input_tokens: number | null;
    output_tokens: number | null;
    cost_usd: number | null;
  } | null>(null);
  // Confirmacao pos-clique de reply: mostra dialog asking "voce postou?"
  interface PendingConfirm {
    tweetId: string;
    tweetUrl?: string;
    tweetAuthor: string;
    tweetText: string;
    replyIndex: number;
    replyText: string;          // texto final (com edits)
    replyTextOriginal: string;  // texto original gerado pelo LLM
    category: string;
    wasEdited: boolean;
    // todas as 3 sugestoes do batch, pra logar pro analytics
    allCandidates: { text: string; category: string }[];
  }
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(
    null
  );

  // ---- Auth state (V4) ----
  // authReady: false ate o primeiro check rodar (evita flash de UI sem dados).
  // userEmail null = nao logado OU Supabase nao configurado.
  const [authReady, setAuthReady] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  // Bypass do wizard: pra rodar local-only mesmo com Supabase configurado,
  // ou pra usuario que clicou "pular" no step de keys.
  const [skipWizard, setSkipWizard] = useState(false);

  async function reloadAuth() {
    const session = isSupabaseConfigured() ? await getSession() : null;
    setUserEmail(session?.user.email ?? null);
    setProfile(await getProfileCache());
    setAuthReady(true);
    // isAdmin (cached por TTL 5min em chrome.storage; fail-safe se RPC falhar)
    if (session) {
      checkIsAdmin()
        .then(setIsAdmin)
        .catch(() => setIsAdmin(false));
    } else {
      setIsAdmin(false);
    }
  }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [rendered, setRendered] = useState<RenderedTweet[]>([]);
  const [lastRefresh, setLastRefresh] = useState<LastRefresh | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("isv");
  // Cooldown pos-refresh: bloqueia o botao por 30s pra evitar duplo-clique
  // que queima cota da TwitterAPI (pay-per-use).
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  // tweets marcados como respondidos pelo analista (por workspace).
  const [repliedIds, setRepliedIds] = useState<string[]>([]);
  // quick test: URL de um tweet pra testar a pipeline so nele.
  const [quickTestUrl, setQuickTestUrl] = useState("");
  const [showQuickTest, setShowQuickTest] = useState(false);

  useEffect(() => {
    if (!cooldownUntil) return;
    const i = setInterval(() => {
      const t = Date.now();
      setNowTick(t);
      if (t >= cooldownUntil) setCooldownUntil(null);
    }, 500);
    return () => clearInterval(i);
  }, [cooldownUntil]);

  const cooldownSecs = cooldownUntil
    ? Math.max(0, Math.ceil((cooldownUntil - nowTick) / 1000))
    : 0;

  // Banner de erros de sync (saveWorkspace/pullAll/pushProfile silenciosos).
  // Toda vez que algo falha no cloud, mostra alerta vermelho com a operacao
  // + mensagem, pro analista saber que nao salvou (evita "achei que salvou").
  useEffect(() => {
    return onSyncError((op, e) => {
      setError(`Sync falhou em '${op}': ${e.message}`);
    });
  }, []);

  // Boot inicial: carrega auth + dados em paralelo.
  useEffect(() => {
    reloadAuth();
    const unsubscribe = onAuthChange(async (session) => {
      try {
        // CRITICO: ao logar, esperar o pullAll terminar ANTES de ler do
        // chrome.storage local. Sem isso o getActiveWorkspace pode rodar
        // antes do sync trazer os workspaces do cloud e cair no fallback
        // de Default vazio (=> nome perdido entre logout/login).
        if (session) {
          await pullAll();
        }
        await reloadAuth();
        setWorkspaces(await listWorkspaces());
        if (session) {
          const fresh = await getActiveWorkspace();
          setWorkspace(fresh);
        } else {
          setWorkspace(null);
        }
      } catch (e) {
        console.warn("[app] onAuthChange refetch:", e);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    (async () => {
      // CRITICO: na BOOT, se ja temos sessao, puxa do cloud ANTES de ler do
      // cache local. Sem isso, chaves/voz salvas em outra sessao podem
      // aparecer vazias por causa de cache stale.
      if (isSupabaseConfigured()) {
        const session = await getSession();
        if (session) {
          try {
            await pullAll();
          } catch (e) {
            console.warn("[app] pullAll on boot:", e);
          }
        }
      }
      const ws = await getActiveWorkspace();
      setWorkspace(ws);
      const list = await listWorkspaces();
      setWorkspaces(list);
      // Primeira execucao OU config incompleta: cai em settings pra setup
      // inicial. Apos o primeiro "salvar", o flag fica marcado e nao forca mais.
      const seenSetup = await getSetupSeen();
      if (!seenSetup || !isConfigComplete(ws.config)) {
        setView("settings");
      }
      const cache = await getSessionCache(ws.id);
      if (cache) {
        setRendered(cache.rendered);
        setLastRefresh({
          collected: cache.collected,
          passed: cache.passed,
          ts: cache.timestamp,
        });
      }
      setRepliedIds(await getRepliedIds(ws.id));
      // carrega preferencia de modo de triagem (per-device)
      try {
        const pref = await chrome.storage.local.get("triage_mode");
        if (pref.triage_mode === "list" || pref.triage_mode === "swipe") {
          setTriageMode(pref.triage_mode);
        }
      } catch {
        /* ok */
      }
    })();
  }, []);

  // Edicao de config do workspace ativo. Se o listId mudou, o cache de sessao
  // do workspace nao vale mais.
  async function handleSaveConfig(cfg: Config) {
    if (!workspace) return;
    const listChanged = workspace.config.listId !== cfg.listId;
    const updated: Workspace = { ...workspace, config: cfg };
    setWorkspace(updated);
    await saveWorkspace(updated);
    // primeira vez que o analista salva: marca setup como visto pra nao
    // forcar settings em re-aberturas futuras.
    await markSetupSeen();
    if (listChanged) {
      await clearSessionCache(updated.id);
      setRendered([]);
      setLastRefresh(null);
    }
    if (isConfigComplete(cfg)) setView("main");
  }

  async function handleSwitchWorkspace(id: string) {
    if (!workspace || id === workspace.id) return;
    const next = await getWorkspace(id);
    if (!next) return;
    await setActiveWorkspaceId(id);
    setWorkspace(next);
    setError(null);
    setInfo(null);
    // troca tambem o cache renderizado pro do novo workspace
    const cache = await getSessionCache(id);
    if (cache) {
      setRendered(cache.rendered);
      setLastRefresh({
        collected: cache.collected,
        passed: cache.passed,
        ts: cache.timestamp,
      });
    } else {
      setRendered([]);
      setLastRefresh(null);
    }
    setRepliedIds(await getRepliedIds(id));
  }

  async function handleExportWorkspace() {
    if (!workspace) return;
    const data = await exportWorkspace(workspace.id);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = workspace.name.replace(/[^a-z0-9_-]/gi, "_");
    a.download = `replai-workspace-${safeName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleImportWorkspace(file: File) {
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const imported = await importWorkspace(payload);
      await setActiveWorkspaceId(imported.id);
      setWorkspace(imported);
      await refreshWorkspaceList();
      setRendered([]);
      setLastRefresh(null);
      setRepliedIds([]);
      setError(null);
      setInfo(`workspace "${imported.name}" importado.`);
    } catch (e) {
      setError(`Erro importando workspace: ${(e as Error).message ?? e}`);
    }
  }

  async function handleToggleReplied(tweetId: string) {
    if (!workspace) return;
    const isReplied = repliedIds.includes(tweetId);
    const next = await setReplied(workspace.id, tweetId, !isReplied);
    setRepliedIds(next);
  }

  // Chamado quando o analista clica em "responder" numa reply: abre o
  // PostConfirmDialog. NAO marca como respondido ate o analista clicar "sim, postei".
  function handleReplyClick(info: PendingConfirm) {
    setPendingConfirm(info);
  }

  // Helper: monta o input pro pushReplyLog com TUDO (50+ campos).
  // Async porque precisa lookup do voice_version_id no Supabase.
  async function buildReplyLog(
    p: PendingConfirm,
    decision: "posted" | "skipped" | "edited_only" | "ignored"
  ): Promise<import("../lib/sync").ReplyLogInput | null> {
    if (!workspace || !userEmail) return null;
    const r = rendered.find((x) => x.result.tweet_id === p.tweetId);
    const tweet = r?.tweet;
    const result = r?.result;
    const nowMs = Date.now();
    const ttd =
      repliesGeneratedAt !== null ? nowMs - repliesGeneratedAt : null;

    // tweet metadata (autor, timing, thread, content) via helpers puros
    const rawTweetForMeta: RawTweet | undefined = tweet?.raw_meta;
    const tweetMeta = extractAllTweetMeta(
      rawTweetForMeta,
      p.tweetText ?? "",
      nowMs
    );

    // voice_version_id: lookup async (idempotente, busca por hash da voz atual)
    const voiceText = workspace.config.voice ?? "";
    let voiceVersionId: string | null = null;
    if (voiceText.trim()) {
      try {
        voiceVersionId = await getVoiceVersionIdByText(workspace.id, voiceText);
      } catch {
        /* no-op */
      }
    }

    // config snapshot (hyperparams pra A/B)
    const configSnapshot = {
      timeWindowHours: workspace.config.timeWindowHours,
      maxBatch: workspace.config.maxBatch,
      includeUnmapped: workspace.config.includeUnmapped,
      model: workspace.config.model,
      langs: workspace.config.langs,
    };

    const llmModel =
      workspace.config.llm_provider === "anthropic"
        ? workspace.config.model
        : "gemini-2.5-flash";

    return {
      user_email: userEmail,
      workspace_id: workspace.id,
      workspace_name: workspace.name,
      session_id: currentSessionId,
      voice_snapshot: voiceText,
      voice_version_id: voiceVersionId,
      config_snapshot: configSnapshot,
      // tweet basico
      tweet_id: p.tweetId,
      tweet_url: p.tweetUrl ?? null,
      tweet_handle: p.tweetAuthor,
      tweet_text: p.tweetText,
      tweet_lang: tweet?.lang ?? null,
      tweet_isv: tweet?.isv ?? null,
      tweet_is_poi: tweet?.is_poi ?? null,
      tweet_inferred_layer: tweet?.inferred_layer ?? null,
      // tweet expandido (todos os 19)
      ...tweetMeta,
      // reply
      reply_text: p.replyText,
      reply_text_original: p.replyTextOriginal,
      reply_category: p.category,
      reply_pattern: result?.pattern ?? null,
      reply_pattern_label: result?.pattern_label ?? null,
      reply_index: p.replyIndex,
      all_candidates: p.allCandidates,
      // decision
      was_edited: p.wasEdited,
      posted_confirmed:
        decision === "posted" ? true : decision === "skipped" ? false : null,
      posted_at: decision === "posted" ? new Date(nowMs).toISOString() : null,
      decision,
      time_to_decide_ms: ttd,
      // llm
      llm_provider: workspace.config.llm_provider,
      llm_model: llmModel,
      llm_input_tokens: currentLlmUsage?.input_tokens ?? null,
      llm_output_tokens: currentLlmUsage?.output_tokens ?? null,
      llm_cost_usd: currentLlmUsage?.cost_usd ?? null,
    };
  }

  async function handleConfirmPosted(data: {
    finalReplyText: string;
    postedReplyId: string | null;
    wasEditedInDialog: boolean;
  }) {
    if (!workspace || !pendingConfirm) return;
    const p = pendingConfirm;
    // wasEdited final = edited antes do clique OR no dialog
    const wasEdited = p.wasEdited || data.wasEditedInDialog;
    // updated PendingConfirm com texto final + reply_id (pra buildReplyLog)
    const enriched: PendingConfirm = {
      ...p,
      replyText: data.finalReplyText,
      wasEdited,
    };
    const next = await setReplied(workspace.id, p.tweetId, true, {
      tweet_author: p.tweetAuthor,
      tweet_text: p.tweetText,
      reply_text: data.finalReplyText,
      reply_category: p.category,
      reply_index: p.replyIndex,
      was_edited: wasEdited,
      posted_confirmed: true,
    });
    setRepliedIds(next);
    track(
      "post_confirmed",
      {
        tweet_id: p.tweetId,
        reply_index: p.replyIndex,
        category: p.category,
        was_edited: wasEdited,
        has_reply_id: Boolean(data.postedReplyId),
      },
      workspace.id
    );
    bumpClicked(currentSessionId).catch(() => {});
    bumpPosted(currentSessionId).catch(() => {});
    try {
      const logInput = await buildReplyLog(enriched, "posted");
      if (logInput) {
        // anexa posted_reply_id (capturado no dialog) ao log
        logInput.posted_reply_id = data.postedReplyId;
        const { pushReplyLog } = await import("../lib/sync");
        pushReplyLog(logInput).catch((e) =>
          console.warn("[app] pushReplyLog confirmed:", e)
        );
      }
    } catch (e) {
      console.warn("[app] buildReplyLog posted falhou:", e);
    }
    setPendingConfirm(null);
  }

  async function handleSkipPost() {
    if (!workspace || !pendingConfirm) return;
    const p = pendingConfirm;
    track(
      "post_skipped",
      {
        tweet_id: p.tweetId,
        reply_index: p.replyIndex,
      },
      workspace.id
    );
    bumpClicked(currentSessionId).catch(() => {});
    bumpSkipped(currentSessionId).catch(() => {});
    try {
      const logInput = await buildReplyLog(p, "skipped");
      if (logInput) {
        const { pushReplyLog } = await import("../lib/sync");
        pushReplyLog(logInput).catch((e) =>
          console.warn("[app] pushReplyLog skipped:", e)
        );
      }
    } catch (e) {
      console.warn("[app] buildReplyLog skipped falhou:", e);
    }
    setPendingConfirm(null);
  }

  function handleEditAgain() {
    // so dispensa - usuario volta pro card pra editar. Nao marca, nao registra.
    setPendingConfirm(null);
  }

  async function refreshWorkspaceList() {
    const list = await listWorkspaces();
    setWorkspaces(list);
  }

  async function handleCreateWorkspace(name: string, duplicate: boolean) {
    const sourceId = duplicate && workspace ? workspace.id : undefined;
    const fresh = await createWorkspace(name, sourceId);
    track(
      "workspace_created",
      { workspace_id: fresh.id, duplicated_from: sourceId ?? null },
      fresh.id
    );
    await setActiveWorkspaceId(fresh.id);
    setWorkspace(fresh);
    await refreshWorkspaceList();
    // workspace novo: comeca sem cache nem replied
    setRendered([]);
    setLastRefresh(null);
    setRepliedIds([]);
    setError(null);
    setInfo(null);
    // workspace novo precisa de setup inicial (Lista, prompt, etc.):
    // mantem o usuario em settings ate ele preencher e fechar.
    setView("settings");
  }

  async function handleRenameWorkspace(name: string) {
    if (!workspace) return;
    await renameWorkspace(workspace.id, name);
    const updated = { ...workspace, name };
    setWorkspace(updated);
    await refreshWorkspaceList();
  }

  async function handleDeleteWorkspace() {
    if (!workspace) return;
    const deletedId = workspace.id;
    const newActiveId = await deleteWorkspace(workspace.id);
    track("workspace_deleted", { workspace_id: deletedId }, newActiveId);
    const next = await getWorkspace(newActiveId);
    if (next) setWorkspace(next);
    await refreshWorkspaceList();
    const cache = await getSessionCache(newActiveId);
    if (cache) {
      setRendered(cache.rendered);
      setLastRefresh({
        collected: cache.collected,
        passed: cache.passed,
        ts: cache.timestamp,
      });
    } else {
      setRendered([]);
      setLastRefresh(null);
    }
    setRepliedIds(await getRepliedIds(newActiveId));
    setError(null);
    setInfo(null);
  }

  // Persiste edits inline das replies. Atualiza o `rendered` em memoria e
  // sobrescreve o cache de sessao do workspace ativo, pra que fechar e reabrir
  // o painel mantenha o que o analista escreveu.
  async function handleReplyEdit(
    tweetId: string,
    replyIdx: number,
    text: string
  ) {
    if (!workspace) return;
    // captura o texto original antes de aplicar pro track
    const originalReply = rendered
      .find((r) => r.result.tweet_id === tweetId)
      ?.result.replies[replyIdx]?.text;
    const updated = rendered.map((r) => {
      if (r.result.tweet_id !== tweetId) return r;
      const newReplies = r.result.replies.map((rep, i) =>
        i === replyIdx ? { ...rep, text } : rep
      );
      return { ...r, result: { ...r.result, replies: newReplies } };
    });
    setRendered(updated);
    if (originalReply !== undefined && originalReply !== text) {
      track(
        "reply_edited",
        {
          tweet_id: tweetId,
          reply_index: replyIdx,
          original_len: originalReply.length,
          edited_len: text.length,
          // texto bruto fora do payload por privacidade (medimos so o delta)
          delta_chars: text.length - originalReply.length,
        },
        workspace.id
      );
    }
    if (lastRefresh) {
      await saveSessionCache(workspace.id, {
        timestamp: lastRefresh.ts,
        collected: lastRefresh.collected,
        passed: lastRefresh.passed,
        rendered: updated,
      });
    }
  }

  // ---- Auth / Wizard handlers ----
  async function handleSignedIn() {
    setSkipWizard(false);
    // a session ja foi salva pelo signIn (storage adapter); reloadAuth pega ela.
    // background ja vai disparar pullAll() + migration via onAuthChange.
    await reloadAuth();
  }

  // Salva keys do profile (chamado de Settings, fluxo separado do workspace).
  // Apos salvar, refresca workspaces locais via pullAll pra cloudConfigToConfig
  // injetar as novas keys em todos os workspace.config.
  async function handleSaveKeys(keys: {
    gemini_api_key: string;
    anthropic_api_key: string;
  }) {
    const updates: Record<string, unknown> = {};
    if (keys.gemini_api_key) updates.gemini_api_key = keys.gemini_api_key;
    if (keys.anthropic_api_key)
      updates.anthropic_api_key = keys.anthropic_api_key;
    // Permite LIMPAR explicitamente: se draft veio vazio E profile tinha, manda
    // string vazia pra zerar. So nao manda quando ambos vazios (no-op).
    if (
      !keys.gemini_api_key &&
      (profile?.gemini_api_key ?? "") !== ""
    ) {
      updates.gemini_api_key = "";
    }
    if (
      !keys.anthropic_api_key &&
      (profile?.anthropic_api_key ?? "") !== ""
    ) {
      updates.anthropic_api_key = "";
    }
    if (Object.keys(updates).length === 0) return;
    const updated = await updateProfile(updates);
    if (updated) setProfile(updated);
    track("keys_updated", {
      gemini: Boolean(keys.gemini_api_key),
      anthropic: Boolean(keys.anthropic_api_key),
      source: "settings",
    });
    // refrescar workspaces com as keys novas
    await pullAll();
    const refreshed = await getActiveWorkspace();
    setWorkspace(refreshed);
  }

  async function handleKeysSaved(keys: {
    twitterapi_key: string;
    gemini_api_key: string;
    anthropic_api_key: string;
  }) {
    // SO inclui keys nao-vazias no update. Sem isso, user que clica "salvar"
    // sem preencher (ou re-faz setup com campos em branco) zeraria as chaves
    // ja salvas no profile.
    const updates: Record<string, unknown> = { setup_complete: true };
    if (keys.twitterapi_key.trim())
      updates.twitterapi_key = keys.twitterapi_key.trim();
    if (keys.gemini_api_key.trim())
      updates.gemini_api_key = keys.gemini_api_key.trim();
    if (keys.anthropic_api_key.trim())
      updates.anthropic_api_key = keys.anthropic_api_key.trim();

    const updated = await updateProfile(updates);
    if (updated) setProfile(updated);
    track("keys_updated", {
      twitterapi: Boolean(keys.twitterapi_key),
      gemini: Boolean(keys.gemini_api_key),
      anthropic: Boolean(keys.anthropic_api_key),
    });
    // refrescar workspaces locais com as keys do profile
    await pullAll();
    const refreshed = await getActiveWorkspace();
    setWorkspace(refreshed);
    setWorkspaces(await listWorkspaces());
  }

  async function handleSkipKeys() {
    // marca setup_complete=true mesmo sem keys (analista pode preencher
    // depois em Settings)
    const updated = await updateProfile({ setup_complete: true });
    if (updated) setProfile(updated);
    setSkipWizard(true);
  }

  async function handleSignOut() {
    try {
      await signOut();
      // background.onAuthChange ja limpa storage; reloadAuth atualiza UI.
      await reloadAuth();
      // recarrega workspaces (deve voltar pro Default vazio se nao houver local)
      const fresh = await getActiveWorkspace();
      setWorkspace(fresh);
      setWorkspaces(await listWorkspaces());
      setView("main");
    } catch (e) {
      console.warn("[app] signOut:", e);
    }
  }

  async function handleQuickTest() {
    if (!workspace || !quickTestUrl.trim()) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const outcome = await runQuickTest(workspace, quickTestUrl.trim());
      setRendered(outcome.rendered);
      setRepliesGeneratedAt(Date.now());
      setLastRefresh({
        collected: outcome.collected,
        passed: outcome.passed,
        ts: Date.now(),
      });
      if (outcome.message) setInfo(outcome.message);
      setCooldownUntil(Date.now() + 30_000);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else setError(`Erro inesperado: ${(e as Error).message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  // Atualizar agora roda APENAS fetch + prefilter (sem LLM) e vai pra triage.
  // Triage view permite o analista escolher quais tweets vao pro LLM, e ai sim
  // dispara generateRepliesForSelected.
  async function handleRefresh() {
    if (!workspace || !isConfigComplete(workspace.config)) {
      setView("settings");
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const outcome = await runTriage(workspace);
      setTriageQueue(outcome.triageQueue);
      setTriageMessage(outcome.message);
      // guarda sessionId pra propagar pra generateRepliesForSelected + reply_logs
      setCurrentSessionId(outcome.sessionId);
      setLastRefresh({
        collected: outcome.collected,
        passed: outcome.passed,
        ts: Date.now(),
      });
      if (outcome.triageQueue.length === 0) {
        // nada pra triar: mantem main com a mensagem
        setInfo(outcome.message ?? "Nada na janela.");
      } else {
        setView("triage");
      }
      setCooldownUntil(Date.now() + 30_000);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError(`Erro inesperado: ${(e as Error).message ?? e}`);
      }
    } finally {
      setLoading(false);
    }
  }

  // Chamado quando o analista termina a triagem e clica "gerar replies".
  // Dispara o LLM so pros tweets selecionados. Propaga sessionId + triageMode
  // pro orchestrator atualizar session_logs (LLM tokens/cost) e captura
  // llmUsage pra reply_logs subsequentes.
  async function handleGenerateRepliesForSelected(selected: EnrichedTweet[]) {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const outcome = await generateRepliesForSelected(workspace, selected, {
        sessionId: currentSessionId,
        triageMode,
      });
      setRendered(outcome.rendered);
      setRepliesGeneratedAt(Date.now());
      setCurrentLlmUsage(outcome.llmUsage ?? null);
      if (outcome.message) setInfo(outcome.message);
      setView("main");
      // triage queue limpa: ja foi consumida
      setTriageQueue([]);
      setTriageMessage(undefined);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError(`Erro inesperado: ${(e as Error).message ?? e}`);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleTriageModeChange(mode: TriageMode) {
    setTriageMode(mode);
    chrome.storage.local.set({ triage_mode: mode }).catch(() => {});
  }

  function handleTriageCancel() {
    setTriageQueue([]);
    setTriageMessage(undefined);
    setView("main");
  }

  // ---- Auth gate / SetupWizard routing ----
  if (!authReady) {
    return (
      <div class="flex min-h-screen items-center justify-center text-sm text-zinc-500">
        carregando...
      </div>
    );
  }
  const supabaseOn = isSupabaseConfigured();
  // Mostra wizard de login so se Supabase ta configurado E nao logado.
  // Em build sem Supabase (legado / V3), pula tudo: local-only normal.
  if (supabaseOn && !userEmail) {
    return (
      <SetupWizard
        step="login"
        profile={null}
        userEmail={null}
        onSignedIn={handleSignedIn}
        onKeysSaved={async () => {}}
        onSkipKeys={() => {}}
      />
    );
  }
  // Logado mas setup_complete=false E user nao escolheu pular: wizard de keys.
  if (supabaseOn && userEmail && profile && !profile.setup_complete && !skipWizard) {
    return (
      <SetupWizard
        step="keys"
        profile={profile}
        userEmail={userEmail}
        onSignedIn={() => {}}
        onKeysSaved={handleKeysSaved}
        onSkipKeys={handleSkipKeys}
      />
    );
  }

  if (view === "admin" && isAdmin) {
    return (
      <AdminPanel
        currentUserId={profile?.id ?? ""}
        onClose={() => setView("main")}
      />
    );
  }

  if (view === "dashboard") {
    return (
      <Dashboard
        workspaceId={workspace?.id ?? null}
        workspaceName={workspace?.name ?? null}
        onClose={() => setView("main")}
      />
    );
  }

  if (view === "triage" && workspace) {
    return (
      <TriageView
        queue={triageQueue}
        windowHours={workspace.config.timeWindowHours}
        message={triageMessage}
        initialMode={triageMode}
        generating={loading}
        onModeChange={handleTriageModeChange}
        onGenerate={handleGenerateRepliesForSelected}
        onCancel={handleTriageCancel}
      />
    );
  }

  if (view === "settings" && workspace) {
    return (
      <Settings
        workspace={workspace}
        workspaces={workspaces}
        profile={profile}
        onSaveConfig={handleSaveConfig}
        onSaveKeys={handleSaveKeys}
        onCreateWorkspace={handleCreateWorkspace}
        onRenameWorkspace={handleRenameWorkspace}
        onDeleteWorkspace={handleDeleteWorkspace}
        onExportWorkspace={handleExportWorkspace}
        onImportWorkspace={handleImportWorkspace}
        onOpenDashboard={() => setView("dashboard")}
        userEmail={userEmail}
        onSignOut={handleSignOut}
        onClose={isConfigComplete(workspace.config) ? () => setView("main") : null}
      />
    );
  }

  const repliedSet = new Set(repliedIds);
  const sorted = [...rendered].sort((a, b) => {
    // respondidos sempre vao pro final, independente do criterio
    const aR = repliedSet.has(a.result.tweet_id);
    const bR = repliedSet.has(b.result.tweet_id);
    if (aR !== bR) return aR ? 1 : -1;
    if (sortBy === "recent") {
      return (
        (Date.parse(b.tweet.timestamp ?? "") || 0) -
        (Date.parse(a.tweet.timestamp ?? "") || 0)
      );
    }
    if (sortBy === "poi") {
      if (b.tweet.is_poi !== a.tweet.is_poi)
        return b.tweet.is_poi - a.tweet.is_poi;
      return b.tweet.isv - a.tweet.isv;
    }
    return b.tweet.isv - a.tweet.isv;
  });

  return (
    <div class="min-h-screen">
      <Header
        workspace={workspace}
        workspaces={workspaces}
        onOpenDashboard={() => setView("dashboard")}
        onSwitchWorkspace={handleSwitchWorkspace}
        collected={lastRefresh?.collected ?? null}
        passed={lastRefresh?.passed ?? null}
        windowHours={workspace?.config.timeWindowHours ?? null}
        lastRefreshTs={lastRefresh?.ts ?? null}
        loading={loading}
        cooldownSecs={cooldownSecs}
        isAdmin={isAdmin}
        onRefresh={handleRefresh}
        onOpenSettings={() => setView("settings")}
        onOpenAdmin={isAdmin ? () => setView("admin") : undefined}
      />

      <div class="flex flex-col gap-3 p-3">
        {error && (
          <div class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {info && !error && (
          <div class="rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-300">
            {info}
          </div>
        )}

        {/* Quick test: testa a pipeline num tweet especifico */}
        <details
          open={showQuickTest}
          onToggle={(e) =>
            setShowQuickTest((e.target as HTMLDetailsElement).open)
          }
          class="rounded border border-zinc-800 bg-zinc-900/40"
        >
          <summary class="cursor-pointer list-none select-none px-2.5 py-1.5 text-[11px] text-zinc-400 hover:bg-zinc-800/40 [&::-webkit-details-marker]:hidden">
            <span class="inline-block w-2 transition-transform group-open:rotate-90">
              ›
            </span>{" "}
            testar um tweet especifico
          </summary>
          <div class="flex flex-col gap-1.5 p-2.5 pt-1">
            <input
              type="text"
              class="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-sky-600"
              placeholder="cole URL do tweet (https://x.com/user/status/...)"
              value={quickTestUrl}
              onInput={(e) =>
                setQuickTestUrl((e.target as HTMLInputElement).value)
              }
            />
            <button
              type="button"
              onClick={handleQuickTest}
              disabled={loading || cooldownSecs > 0 || !quickTestUrl.trim()}
              class="self-start rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading
                ? "..."
                : cooldownSecs > 0
                  ? `${cooldownSecs}s`
                  : "rodar quick test"}
            </button>
            <div class="text-[10px] text-zinc-500">
              pula o prefilter da Lista. roda a pipeline so neste tweet
              (substitui o cache da sessao atual).
            </div>
          </div>
        </details>

        {rendered.length > 0 && (
          <div class="flex items-center gap-2 text-xs text-zinc-400">
            <span>ordenar por</span>
            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy((e.target as HTMLSelectElement).value as SortBy)
              }
              class="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-sky-600"
            >
              <option value="isv">ISV (maior primeiro)</option>
              <option value="recent">mais recentes</option>
              <option value="poi">POI primeiro</option>
            </select>
          </div>
        )}

        {loading && rendered.length === 0 && (
          <div class="py-10 text-center text-sm text-zinc-500">
            puxando tweets e gerando replies...
          </div>
        )}

        {!loading && rendered.length === 0 && !error && !info && (
          <div class="py-10 text-center text-sm text-zinc-500">
            aperte <span class="text-sky-400">atualizar</span> pra puxar tweets
            da Lista.
          </div>
        )}

        {pendingConfirm && (
          <PostConfirmDialog
            pendingTweetId={pendingConfirm.tweetId}
            tweetText={pendingConfirm.tweetText}
            tweetHandle={pendingConfirm.tweetAuthor}
            replyIndex={pendingConfirm.replyIndex}
            originalReplyText={pendingConfirm.replyText}
            category={pendingConfirm.category}
            wasEdited={pendingConfirm.wasEdited}
            onConfirmPosted={handleConfirmPosted}
            onSkipped={handleSkipPost}
            onEditAgain={handleEditAgain}
          />
        )}

        {sorted.map((r) => (
          <TweetCard
            key={r.result.tweet_id}
            data={r}
            replied={repliedIds.includes(r.result.tweet_id)}
            onToggleReplied={() => handleToggleReplied(r.result.tweet_id)}
            onReplyClick={handleReplyClick}
            onReplyEdit={(idx, text) =>
              handleReplyEdit(r.result.tweet_id, idx, text)
            }
          />
        ))}
      </div>
    </div>
  );
}
