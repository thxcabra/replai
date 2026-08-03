import { ApiError } from "./errors";
import { loadGraph } from "./graph";
import { deriveAuthorTier, enrichWithIntelligence } from "./intelligence";
import { ANTHROPIC_API_KEY, GEMINI_API_KEY, TWITTERAPI_KEY } from "./keys";
import { generateReplies } from "./llm";
import { track } from "./metrics";
import { buildContext, emptyDiscards, prefilter } from "./prefilter";
import { trackLLMCall } from "./reply-core/cost-tracker";
import { applyScores, scoreTweets } from "./selection-scorer";
import {
  endSession as endSessionLog,
  recordError,
  recordFetch,
  recordTriage,
  recordTriageSelected,
  startSession,
  type SessionId,
} from "./session-tracking";
import { saveSessionCache } from "./storage";
import {
  fetchListTweets,
  fetchTweetById,
  fetchTweetsBatch,
} from "./twitterapi";
import { parseTweetDate } from "./util";
import type {
  DiscardReason,
  EnrichedTweet,
  PayloadTweet,
  RawTweet,
  RenderedTweet,
  SkillReply,
  SkillSummary,
  Workspace,
} from "./types";

export interface RefreshOutcome {
  collected: number;
  passed: number;
  rendered: RenderedTweet[];
  discards: Record<DiscardReason, number>;
  skillSummary?: SkillSummary;
  message?: string;
  sessionId?: SessionId;
  llmUsage?: {
    input_tokens: number | null;
    output_tokens: number | null;
    cost_usd: number | null;
  };
  // V4.1: tweets ocultos pelo selection-scorer (banner expansivel na triagem)
  triageHidden?: EnrichedTweet[];
}

function toPayloadTweet(
  t: EnrichedTweet,
  options?: {
    attachmentsByTweetId?: Record<string, string>;
    regen?: { reply_index: number; keep_categories: string[] };
  }
): PayloadTweet {
  const p: PayloadTweet = {
    tweet_id: t.tweet_id,
    handle: t.handle,
    text: t.text,
    lang: t.lang,
    timestamp: t.timestamp,
    isv: t.isv,
    inferred_layer: t.inferred_layer,
    is_poi: t.is_poi,
    context: t.context,
  };
  if (t.not_in_graph) p.not_in_graph = true;
  if (t.media && t.media.length > 0) p.media = t.media;
  if (t.author_context) p.author_context = t.author_context;
  const attUrl = options?.attachmentsByTweetId?.[t.tweet_id]?.trim();
  if (attUrl) p.attachments = [{ url: attUrl }];
  if (options?.regen) p.regen = options.regen;
  return p;
}

// V4.1 — 2.10: derive author_context pra cada tweet (chamado apos scorer).
function buildAuthorContext(t: EnrichedTweet): EnrichedTweet["author_context"] {
  const tier = deriveAuthorTier(t.isv, t.raw_meta?.author?.followers);
  return {
    handle: t.handle,
    isv: t.isv,
    inferred_layer: t.inferred_layer,
    is_poi: t.is_poi === 1,
    tier,
    engagement_potential: t.engagement_potential ?? null,
    persona_relevance: t.persona_relevance ?? null,
    is_first_contact: t.intelligence?.author_profile?.is_first_contact,
    engagement_back_rate: t.intelligence?.author_profile?.engagement_back_rate,
    successful_categories:
      t.intelligence?.author_profile?.successful_categories,
    cooldown_recommended:
      t.intelligence?.author_profile?.cooldown_recommended,
  };
}

// V4.1.1: resolve quais listas a buscar pra um refresh:
//   - se workspace tem `lists` >= 2 e fetchAllLists, retorna TODAS
//   - se tem `lists` e activeListId, retorna SO a ativa
//   - senao cai pro listId legacy (compat com V4.0)
function resolveListsToFetch(config: import("./types").Config): string[] {
  if (config.lists && config.lists.length > 0) {
    if (config.fetchAllLists && config.lists.length >= 2) {
      return config.lists
        .map((l) => l.listId)
        .filter((id): id is string => !!id && id.trim().length > 0);
    }
    if (config.activeListId) {
      const active = config.lists.find((l) => l.id === config.activeListId);
      if (active) return [active.listId];
    }
    // fallback: primeira lista
    return [config.lists[0].listId];
  }
  return config.listId ? [config.listId] : [];
}

// remove tweets repetidos entre paginas da mesma sessao
function dedupById(tweets: RawTweet[]): RawTweet[] {
  const seen = new Set<string>();
  const out: RawTweet[] = [];
  for (const t of tweets) {
    if (!t.id || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

// Pra cada reply dentro da janela, busca o tweet pai em batch (uma request
// pra todos os parents distintos) e anexa em `parent_tweet`. A TwitterAPI nao
// devolve o texto do parent inline pra replies, so o id+handle. Best-effort:
// se a chamada falha, a sessao continua e buildContext cai pro fallback
// ("reply to @x" sem texto). Filtra por janela antes pra nao pagar parents
// de replies que o prefilter ja vai descartar por idade.
async function enrichReplyParents(
  raw: RawTweet[],
  twitterKey: string,
  sinceMs: number
): Promise<void> {
  const replies: RawTweet[] = [];
  const parentIds: string[] = [];
  const seenIds = new Set<string>();

  for (const t of raw) {
    if (!t.isReply || !t.inReplyToId) continue;
    if (t.parent_tweet !== undefined) continue;
    const createdAtMs = parseTweetDate(t.createdAt);
    if (createdAtMs !== null && createdAtMs < sinceMs) continue;
    replies.push(t);
    if (!seenIds.has(t.inReplyToId)) {
      seenIds.add(t.inReplyToId);
      parentIds.push(t.inReplyToId);
    }
  }

  if (parentIds.length === 0) return;

  try {
    const parents = await fetchTweetsBatch(parentIds, twitterKey);
    const byId = new Map<string, RawTweet>();
    for (const p of parents) {
      if (p.id) byId.set(p.id, p);
    }
    for (const reply of replies) {
      const parent = reply.inReplyToId
        ? byId.get(reply.inReplyToId)
        : undefined;
      reply.parent_tweet = parent ?? null;
    }
  } catch (e) {
    // best-effort: prossegue sem parent text
    console.warn("[replai] enrichReplyParents falhou:", e);
  }
}

// ---- TRIAGE: split em fetch+prefilter (sem LLM) e geracao de replies. ----
// Permite o analista escolher quais tweets vao pro LLM, economizando tokens.

export interface TriageOutcome {
  triageQueue: EnrichedTweet[];       // tweets que passaram o prefilter (visiveis)
  triageHidden: EnrichedTweet[];      // V4.1: ocultos pelo selection-scorer
  collected: number;
  passed: number;
  discards: Record<DiscardReason, number>;
  message?: string;
  sessionId: SessionId;               // pra propagar pra generateRepliesForSelected
  scorerEnabled?: boolean;
  scorerMs?: number;
}

// Fase 1: busca tweets da janela, prefilter, devolve queue pra triagem.
// NAO chama LLM. Token cost: zero. So custa a TwitterAPI fetch.
export async function runTriage(workspace: Workspace): Promise<TriageOutcome> {
  const { config, id: workspaceId, name: workspaceName } = workspace;
  const now = Date.now();
  const sinceMs = now - config.timeWindowHours * 60 * 60 * 1000;

  // cria session_log (NULL se nao logado/Supabase off)
  const sessionId = await startSession({
    workspace_id: workspaceId,
    workspace_name: workspaceName,
  });

  track(
    "session_started",
    {
      window_h: config.timeWindowHours,
      provider: config.llm_provider,
      has_voice: Boolean(config.voice?.trim()),
      voice_len: config.voice?.length ?? 0,
      mode: "triage",
    },
    workspaceId
  );

  const twitterKey = config.twitterapi_key.trim() || TWITTERAPI_KEY;
  if (!twitterKey) {
    await recordError(sessionId, "twitterapi", "sem chave TwitterAPI");
    throw new ApiError(
      "twitter",
      "Configure a chave da TwitterAPI nas configuracoes (twitterapi.io) ou no .env."
    );
  }

  const fetchStart = Date.now();
  let raw: RawTweet[];
  // V4.1.1: multi-list resolution:
  //   - se fetchAllLists e true e ha >=2 listas → fetch de TODAS em paralelo + merge
  //   - senao usa a lista ativa (ou listId legacy)
  const listsToFetch = resolveListsToFetch(config);
  try {
    if (listsToFetch.length === 1) {
      raw = dedupById(
        await fetchListTweets(
          listsToFetch[0],
          twitterKey,
          sinceMs,
          config.maxPages
        )
      );
    } else {
      // paralelo: cada lista vira uma promise, depois merge + dedup
      const batches = await Promise.all(
        listsToFetch.map((lid) =>
          fetchListTweets(lid, twitterKey, sinceMs, config.maxPages).catch(
            (e) => {
              console.warn(`[orchestrator] fetch list ${lid} falhou:`, e);
              return [] as RawTweet[];
            }
          )
        )
      );
      raw = dedupById(batches.flat());
    }
  } catch (e) {
    await recordError(
      sessionId,
      "twitterapi",
      (e as Error).message ?? "fetch falhou"
    );
    throw e;
  }
  const fetchMs = Date.now() - fetchStart;
  await recordFetch(sessionId, raw.length, fetchMs);
  track(
    "tweets_fetched",
    { count: raw.length, ms: fetchMs, lists_fetched: listsToFetch.length },
    workspaceId
  );

  if (raw.length === 0) {
    await recordTriage(sessionId, 0, 0, null);
    await endSessionLog(sessionId);
    return {
      triageQueue: [],
      triageHidden: [],
      collected: 0,
      passed: 0,
      discards: emptyDiscards(),
      message: "Nada na Lista.",
      sessionId,
    };
  }

  await enrichReplyParents(raw, twitterKey, sinceMs);

  const graph = await loadGraph(workspaceId);
  const pf = prefilter(raw, config, graph, now);

  if (pf.passed.length === 0) {
    await recordTriage(sessionId, 0, 0, null);
    await endSessionLog(sessionId);
    return {
      triageQueue: [],
      triageHidden: [],
      collected: pf.collected,
      passed: 0,
      discards: pf.discards,
      message: `${pf.collected} tweets na janela, nenhum passou nos filtros.`,
      sessionId,
    };
  }

  // Respeita maxBatch como teto da QUEUE.
  const capped = pf.passed.slice(0, config.maxBatch);

  // V4.1 — 2.11: enriquece com intelligence (analise post + author_profile +
  // batch_relations). Cacheado, ~500ms-1s.
  const enriched = await enrichWithIntelligence(capped);

  // V4.1 — 2.9: chama selection scorer dual (relevancia + engajamento).
  // Sem chave Gemini ou sem voz → scorer pulado, todos passam pra triage.
  const scoreResult = await scoreTweets(enriched, config);
  const { visible, hidden } = applyScores(enriched, scoreResult, config);

  // V4.1 — 2.10: anexa author_context em CADA tweet (visible+hidden) pro
  // skill-prompt receber tier + signals quando gerar replies.
  for (const t of [...visible, ...hidden]) {
    t.author_context = buildAuthorContext(t);
  }

  // triage_selected fica null aqui; sera atualizado em generateRepliesForSelected
  await recordTriage(sessionId, visible.length, 0, null);

  const baseMsg =
    pf.passed.length > capped.length
      ? `${pf.passed.length} tweets na janela, mostrando os ${capped.length} de maior ISV (aumente maxBatch em settings pra ver mais).`
      : undefined;
  const filterMsg =
    scoreResult.enabled && hidden.length > 0
      ? `${visible.length} de ${capped.length} relevantes pra persona (${hidden.length} ocultos pelo filtro).`
      : undefined;
  const message = filterMsg ?? baseMsg;

  return {
    triageQueue: visible,
    triageHidden: hidden,
    collected: pf.collected,
    passed: pf.passed.length,
    discards: pf.discards,
    message,
    sessionId,
    scorerEnabled: scoreResult.enabled,
    scorerMs: scoreResult.ms,
  };
}

// Fase 2: dado um subset de tweets (selecionados na triagem), chama o LLM e
// devolve replies. So gasta tokens nos tweets que o analista pegou.
// sessionId vem do runTriage e e usado pra atualizar a row de session_logs.
export async function generateRepliesForSelected(
  workspace: Workspace,
  selected: EnrichedTweet[],
  options?: {
    sessionId?: SessionId;
    triageMode?: "list" | "swipe";
    // V4.1 — 2.5: attachments por tweet (URL extra de contexto). Map de
    // tweet_id -> url (string vazia = ignorar).
    attachmentsByTweetId?: Record<string, string>;
  }
): Promise<RefreshOutcome> {
  const { config, id: workspaceId } = workspace;
  const now = Date.now();
  const sessionId = options?.sessionId ?? null;

  // V4.1.14 (WR-10): so atualiza triage_selected + mode. Antes sobrescrevia
  // triage_passed com selected.length, perdendo distincao entre "passou no
  // prefilter+scorer" e "user selecionou pro LLM".
  if (sessionId) {
    await recordTriageSelected(
      sessionId,
      selected.length,
      options?.triageMode ?? null
    );
  }

  if (selected.length === 0) {
    await endSessionLog(sessionId);
    return {
      collected: 0,
      passed: 0,
      rendered: [],
      discards: emptyDiscards(),
      message: "Nada selecionado.",
      sessionId,
    };
  }

  const llmKey =
    config.llm_provider === "anthropic"
      ? config.anthropic_api_key.trim() || ANTHROPIC_API_KEY
      : config.gemini_api_key.trim() || GEMINI_API_KEY;
  const effectiveDryRun = config.dryRun || !llmKey;
  const autoDryRun = !config.dryRun && !llmKey;

  let rendered: RenderedTweet[];
  let skillSummary: SkillSummary | undefined;
  let llmUsage: RefreshOutcome["llmUsage"] = undefined;
  const model =
    config.llm_provider === "anthropic" ? config.model : "gemini-2.5-flash";

  if (effectiveDryRun) {
    rendered = selected.map((tweet) => ({
      tweet,
      result: {
        tweet_id: tweet.tweet_id,
        handle: tweet.handle,
        isv: tweet.isv,
        inferred_layer: tweet.inferred_layer,
        is_poi: tweet.is_poi,
        pattern: 0,
        pattern_label: "dry-run",
        replies: [],
        ...(tweet.not_in_graph ? { not_in_graph: true } : {}),
      },
    }));
  } else {
    const llmStart = Date.now();
    let llmResult;
    try {
      llmResult = await generateReplies(
        {
          tweets: selected.map((t) =>
            toPayloadTweet(t, {
              attachmentsByTweetId: options?.attachmentsByTweetId,
            })
          ),
        },
        config
      );
    } catch (e) {
      await recordError(sessionId, "llm", (e as Error).message ?? "llm falhou");
      throw e;
    }
    const llmMs = Date.now() - llmStart;
    const { cost_usd: cost } = await trackLLMCall({
      sessionId,
      workspaceId,
      channel: "twitter",
      provider: config.llm_provider,
      model,
      ms: llmMs,
      usage: llmResult.usage,
      itemsIn: selected.length,
      resultsOut: llmResult.output.results.length,
      hasVoice: Boolean(config.voice?.trim()),
      source: "triage_selected",
    });
    llmUsage = {
      input_tokens: llmResult.usage.input_tokens,
      output_tokens: llmResult.usage.output_tokens,
      cost_usd: cost,
    };
    const byId = new Map<string, EnrichedTweet>(
      selected.map((t) => [t.tweet_id, t])
    );
    rendered = llmResult.output.results
      .map((result) => {
        const tweet = byId.get(result.tweet_id);
        return tweet ? { tweet, result } : null;
      })
      .filter((x): x is RenderedTweet => x !== null);
    skillSummary = llmResult.output.summary;
  }

  await saveSessionCache(workspaceId, {
    timestamp: now,
    collected: selected.length,
    passed: rendered.length,
    rendered,
  });

  let message: string | undefined;
  if (autoDryRun) {
    message =
      "sem chave de LLM - rodou em dry-run. configure em settings pra gerar replies de verdade.";
  } else if (config.dryRun) {
    message = `dry-run: ${rendered.length} replies nao geradas.`;
  } else if (rendered.length === 0) {
    message = "Nenhum reply gerado (skill descartou tudo).";
  } else {
    message = `${rendered.length} reply(s) prontos.`;
  }

  return {
    collected: selected.length,
    passed: rendered.length,
    rendered,
    discards: emptyDiscards(),
    skillSummary,
    message,
    sessionId,
    llmUsage,
  };
}

// V4.1 — 2.6: Regenerar 1 reply especifica. Chama LLM com payload de 1 tweet +
// flag `regen` no payload (skill-prompt instrui a retornar 1 reply nova com
// categoria diferente das existentes). Retorna a reply nova OR null se falhar.
export interface RegenerateOutcome {
  reply: SkillReply | null;
  llmUsage: {
    input_tokens: number | null;
    output_tokens: number | null;
    cost_usd: number | null;
  } | null;
  message?: string;
}

export async function regenerateSingleReply(
  workspace: Workspace,
  tweet: EnrichedTweet,
  replyIndex: number,
  existingReplies: SkillReply[],
  options?: { attachmentUrl?: string }
): Promise<RegenerateOutcome> {
  const { config, id: workspaceId } = workspace;

  const llmKey =
    config.llm_provider === "anthropic"
      ? config.anthropic_api_key.trim() || ANTHROPIC_API_KEY
      : config.gemini_api_key.trim() || GEMINI_API_KEY;
  if (!llmKey) {
    return {
      reply: null,
      llmUsage: null,
      message: "Sem chave LLM. Configure em settings pra regerar replies.",
    };
  }

  const keepCategories = existingReplies
    .map((r, i) => (i !== replyIndex ? String(r.category) : null))
    .filter((c): c is string => !!c);

  const attachments: Record<string, string> = {};
  if (options?.attachmentUrl?.trim()) {
    attachments[tweet.tweet_id] = options.attachmentUrl.trim();
  }

  const payload = {
    tweets: [
      toPayloadTweet(tweet, {
        attachmentsByTweetId: attachments,
        regen: { reply_index: replyIndex, keep_categories: keepCategories },
      }),
    ],
  };

  const model =
    config.llm_provider === "anthropic" ? config.model : "gemini-2.5-flash";

  const llmStart = Date.now();
  let llmResult;
  try {
    llmResult = await generateReplies(payload, config);
  } catch (e) {
    return {
      reply: null,
      llmUsage: null,
      message: `Falha LLM: ${(e as Error).message ?? e}`,
    };
  }

  const { cost_usd: cost } = await trackLLMCall({
    sessionId: null,
    workspaceId,
    channel: "twitter",
    provider: config.llm_provider,
    model,
    ms: Date.now() - llmStart,
    usage: llmResult.usage,
    itemsIn: 1,
    resultsOut: llmResult.output.results.length,
    hasVoice: Boolean(config.voice?.trim()),
    source: "regenerate",
  });

  const result = llmResult.output.results[0];
  const fresh = result?.replies?.[0] ?? null;
  return {
    reply: fresh,
    llmUsage: {
      input_tokens: llmResult.usage.input_tokens,
      output_tokens: llmResult.usage.output_tokens,
      cost_usd: cost,
    },
    message: fresh ? undefined : "LLM nao gerou reply nova.",
  };
}

// ---- LEGACY: runRefresh = triage + auto-generate. Mantido pra back-compat. ----

// Uma sessao: busca os tweets da janela (ultimas N horas), filtra, e devolve o
// conjunto completo. Cada chamada RESETA (nao acumula com a sessao anterior).
// Opera sobre o workspace ativo: usa o config dele e carrega o grafo dele.
export async function runRefresh(
  workspace: Workspace
): Promise<RefreshOutcome> {
  const { config, id: workspaceId } = workspace;
  const now = Date.now();
  const sinceMs = now - config.timeWindowHours * 60 * 60 * 1000;

  track(
    "session_started",
    {
      window_h: config.timeWindowHours,
      provider: config.llm_provider,
      has_voice: Boolean(config.voice?.trim()),
      voice_len: config.voice?.length ?? 0,
    },
    workspaceId
  );

  const twitterKey = config.twitterapi_key.trim() || TWITTERAPI_KEY;
  if (!twitterKey) {
    throw new ApiError(
      "twitter",
      "Configure a chave da TwitterAPI nas configuracoes (twitterapi.io) ou no .env."
    );
  }

  // V4.1.1: resolve listas a buscar (multi-list + fetchAllLists support).
  const listsToFetch2 = resolveListsToFetch(config);
  const fetchStart = Date.now();
  let raw: RawTweet[];
  if (listsToFetch2.length === 1) {
    raw = dedupById(
      await fetchListTweets(
        listsToFetch2[0],
        twitterKey,
        sinceMs,
        config.maxPages
      )
    );
  } else {
    const batches = await Promise.all(
      listsToFetch2.map((lid) =>
        fetchListTweets(lid, twitterKey, sinceMs, config.maxPages).catch(
          () => [] as RawTweet[]
        )
      )
    );
    raw = dedupById(batches.flat());
  }
  track(
    "tweets_fetched",
    { count: raw.length, ms: Date.now() - fetchStart },
    workspaceId
  );

  if (raw.length === 0) {
    const empty = await emptySession(workspaceId, now);
    return { ...empty, message: "Nada na Lista." };
  }

  // Enriquece replies (dentro da janela) com o texto do tweet pai pra o LLM
  // ter o contexto completo. Best-effort.
  await enrichReplyParents(raw, twitterKey, sinceMs);

  const graph = await loadGraph(workspaceId);
  const pf = prefilter(raw, config, graph, now);

  if (pf.passed.length === 0) {
    const empty = await emptySession(workspaceId, now, pf.collected);
    return {
      ...empty,
      discards: pf.discards,
      message: `${pf.collected} tweets na janela, nenhum passou nos filtros (retweets, idioma, etc.).`,
    };
  }

  const toSend = pf.passed.slice(0, config.maxBatch);
  const overflow = pf.passed.length - toSend.length;

  // Auto dry-run: se nao ha chave de LLM disponivel pro provider ativo, roda
  // em dry-run em vez de levantar erro - assim o analista pelo menos ve os
  // tweets filtrados e fica claro o que falta configurar.
  const llmKey =
    config.llm_provider === "anthropic"
      ? config.anthropic_api_key.trim() || ANTHROPIC_API_KEY
      : config.gemini_api_key.trim() || GEMINI_API_KEY;
  const effectiveDryRun = config.dryRun || !llmKey;
  const autoDryRun = !config.dryRun && !llmKey;

  let rendered: RenderedTweet[];
  let skillSummary: SkillSummary | undefined;

  if (effectiveDryRun) {
    rendered = toSend.map((tweet) => ({
      tweet,
      result: {
        tweet_id: tweet.tweet_id,
        handle: tweet.handle,
        isv: tweet.isv,
        inferred_layer: tweet.inferred_layer,
        is_poi: tweet.is_poi,
        pattern: 0,
        pattern_label: "dry-run",
        replies: [],
        ...(tweet.not_in_graph ? { not_in_graph: true } : {}),
      },
    }));
  } else {
    const llmStart = Date.now();
    const llmResult = await generateReplies(
      { tweets: toSend.map((t) => toPayloadTweet(t)) },
      config
    );
    track(
      "llm_called",
      {
        provider: config.llm_provider,
        model: config.llm_provider === "anthropic" ? config.model : "gemini-2.5-flash",
        ms: Date.now() - llmStart,
        tweets_in: toSend.length,
        results: llmResult.output.results.length,
        has_voice: Boolean(config.voice?.trim()),
        input_tokens: llmResult.usage.input_tokens,
        output_tokens: llmResult.usage.output_tokens,
      },
      workspaceId
    );
    const byId = new Map<string, EnrichedTweet>(
      toSend.map((t) => [t.tweet_id, t])
    );
    rendered = llmResult.output.results
      .map((result) => {
        const tweet = byId.get(result.tweet_id);
        return tweet ? { tweet, result } : null;
      })
      .filter((x): x is RenderedTweet => x !== null);
    skillSummary = llmResult.output.summary;
  }

  await saveSessionCache(workspaceId, {
    timestamp: now,
    collected: pf.collected,
    passed: rendered.length,
    rendered,
  });

  let message: string | undefined;
  if (autoDryRun) {
    message = `sem chave de LLM configurada - rodou em dry-run: ${rendered.length} post(s) na janela de ${config.timeWindowHours}h. configure uma chave em settings pra gerar replies.`;
  } else if (config.dryRun) {
    message = `dry-run: ${rendered.length} post(s) na janela de ${config.timeWindowHours}h (replies nao geradas).`;
  } else if (rendered.length === 0) {
    message = "Nenhum tweet passou na triagem semantica.";
  } else if (overflow > 0) {
    message = `${overflow} post(s) acima do teto de batch ficaram de fora desta sessao.`;
  }

  return {
    collected: pf.collected,
    passed: rendered.length,
    rendered,
    discards: pf.discards,
    skillSummary,
    message,
  };
}

// Roda a pipeline em UM tweet escolhido pelo analista via URL. Diferente do
// runRefresh, pula o prefilter (o analista escolheu este tweet de proposito),
// mas faz o mesmo enriquecimento + chamada ao LLM. Util pra testar ajustes
// de persona em tweets especificos sem esperar eles entrarem na Lista.
export async function runQuickTest(
  workspace: Workspace,
  tweetUrl: string
): Promise<RefreshOutcome> {
  const { config, id: workspaceId, name: workspaceName } = workspace;
  const now = Date.now();

  // V4.1.14 (WR-16): cria session_log dedicado pra quick test. Antes,
  // replies do quick test ficavam orfãs (sem session_id) ou herdavam o
  // sessionId stale da triagem anterior.
  const sessionId = await startSession({
    workspace_id: workspaceId,
    workspace_name: workspaceName,
  });

  const idMatch = tweetUrl.match(/status\/(\d+)/);
  const tweetId = idMatch ? idMatch[1] : tweetUrl.trim();
  // V4.1.14 (WR-06): bound input length pra prevenir gasto descontrolado
  // de creditos TwitterAPI caso ID anormalmente grande seja enviado.
  // Tweet IDs reais sao 18-19 digits hoje, range 6-25 cobre passado+margem.
  if (!/^\d{6,25}$/.test(tweetId)) {
    throw new ApiError(
      "twitter",
      "URL ou ID invalido. Cole algo como https://x.com/user/status/1234567890"
    );
  }

  const twitterKey = config.twitterapi_key.trim() || TWITTERAPI_KEY;
  if (!twitterKey) {
    throw new ApiError(
      "twitter",
      "Configure a chave da TwitterAPI nas configuracoes ou no .env."
    );
  }

  const raw = await fetchTweetById(tweetId, twitterKey);
  if (!raw) {
    const empty = await emptySession(workspaceId, now);
    return { ...empty, message: "Tweet nao encontrado." };
  }

  // Se for reply, busca o tweet pai pra ter o context completo (mesmo
  // tratamento que runRefresh faz pra Lista). Best-effort.
  if (raw.isReply && raw.inReplyToId && raw.parent_tweet === undefined) {
    try {
      const parent = await fetchTweetById(raw.inReplyToId, twitterKey);
      raw.parent_tweet = parent ?? null;
    } catch (e) {
      console.warn("[replai] quick test parent fetch falhou:", e);
    }
  }

  const graph = await loadGraph(workspaceId);
  const handle = (raw.author?.userName ?? "").toLowerCase();
  const entry = graph[handle];
  const createdAtMs = parseTweetDate(raw.createdAt);

  const enriched: EnrichedTweet = {
    tweet_id: raw.id ?? tweetId,
    handle,
    text: raw.text ?? "",
    lang: raw.lang ?? "",
    timestamp:
      createdAtMs !== null ? new Date(createdAtMs).toISOString() : undefined,
    isv: entry?.isv ?? 50,
    inferred_layer: entry?.inferred_layer ?? 3,
    is_poi: entry?.is_poi ?? 0,
    // Usa o mesmo helper do prefilter pra ter QT + reply parent text na context.
    // Antes o quick test sempre setava `null` aqui, perdendo o contexto.
    context: buildContext(raw, graph),
    url: raw.url,
    is_limited_reply: raw.isLimitedReply === true,
    raw_meta: raw,
    ...(entry ? {} : { not_in_graph: true }),
  };

  const llmKey =
    config.llm_provider === "anthropic"
      ? config.anthropic_api_key.trim() || ANTHROPIC_API_KEY
      : config.gemini_api_key.trim() || GEMINI_API_KEY;
  const effectiveDryRun = config.dryRun || !llmKey;
  const autoDryRun = !config.dryRun && !llmKey;

  let rendered: RenderedTweet[];
  let skillSummary: SkillSummary | undefined;

  if (effectiveDryRun) {
    rendered = [
      {
        tweet: enriched,
        result: {
          tweet_id: enriched.tweet_id,
          handle,
          isv: enriched.isv,
          inferred_layer: enriched.inferred_layer,
          is_poi: enriched.is_poi,
          pattern: 0,
          pattern_label: "dry-run",
          replies: [],
          ...(enriched.not_in_graph ? { not_in_graph: true } : {}),
        },
      },
    ];
  } else {
    const llmStart = Date.now();
    const llmResult = await generateReplies(
      { tweets: [toPayloadTweet(enriched)] },
      config
    );
    await trackLLMCall({
      sessionId: null,
      workspaceId,
      channel: "twitter",
      provider: config.llm_provider,
      model:
        config.llm_provider === "anthropic" ? config.model : "gemini-2.5-flash",
      ms: Date.now() - llmStart,
      usage: llmResult.usage,
      itemsIn: 1,
      resultsOut: llmResult.output.results.length,
      hasVoice: Boolean(config.voice?.trim()),
      source: "quick_test",
    });
    rendered = llmResult.output.results.map((result) => ({ tweet: enriched, result }));
    skillSummary = llmResult.output.summary;
  }

  await saveSessionCache(workspaceId, {
    timestamp: now,
    collected: 1,
    passed: rendered.length,
    rendered,
  });

  let message: string | undefined;
  if (autoDryRun) {
    message =
      "quick test em dry-run (sem chave de LLM configurada). configure em settings pra gerar replies.";
  } else if (config.dryRun) {
    message = "quick test em dry-run (replies nao geradas).";
  } else if (rendered.length === 0) {
    message = "tweet descartado pela skill (anti-padrao semantico).";
  } else {
    message = "quick test pronto.";
  }

  // V4.1.14 (WR-16): encerra session_log do quick test pra logging consistente
  if (sessionId) {
    try {
      await endSessionLog(sessionId);
    } catch {
      /* nao bloqueia o outcome */
    }
  }

  return {
    collected: 1,
    passed: rendered.length,
    rendered,
    discards: emptyDiscards(),
    skillSummary,
    sessionId: sessionId ?? undefined,
    message,
  };
}

async function emptySession(
  workspaceId: string,
  now: number,
  collected = 0
): Promise<RefreshOutcome> {
  await saveSessionCache(workspaceId, {
    timestamp: now,
    collected,
    passed: 0,
    rendered: [],
  });
  return {
    collected,
    passed: 0,
    rendered: [],
    discards: emptyDiscards(),
  };
}
