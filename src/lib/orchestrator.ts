import { ApiError } from "./errors";
import { estimateCost } from "./cost-calc";
import { loadGraph } from "./graph";
import { ANTHROPIC_API_KEY, GEMINI_API_KEY, TWITTERAPI_KEY } from "./keys";
import { generateReplies } from "./llm";
import { track } from "./metrics";
import { buildContext, emptyDiscards, prefilter } from "./prefilter";
import {
  endSession as endSessionLog,
  recordError,
  recordFetch,
  recordLLM,
  recordTriage,
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
}

function toPayloadTweet(t: EnrichedTweet): PayloadTweet {
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
  return p;
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
  triageQueue: EnrichedTweet[];       // tweets que passaram o prefilter
  collected: number;
  passed: number;
  discards: Record<DiscardReason, number>;
  message?: string;
  sessionId: SessionId;               // pra propagar pra generateRepliesForSelected
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
  try {
    raw = dedupById(await fetchListTweets(config.listId, twitterKey, sinceMs));
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
    { count: raw.length, ms: fetchMs },
    workspaceId
  );

  if (raw.length === 0) {
    await recordTriage(sessionId, 0, 0, null);
    await endSessionLog(sessionId);
    return {
      triageQueue: [],
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
      collected: pf.collected,
      passed: 0,
      discards: pf.discards,
      message: `${pf.collected} tweets na janela, nenhum passou nos filtros.`,
      sessionId,
    };
  }

  // Respeita maxBatch como teto da QUEUE.
  const triageQueue = pf.passed.slice(0, config.maxBatch);
  // triage_selected fica null aqui; sera atualizado em generateRepliesForSelected
  await recordTriage(sessionId, triageQueue.length, 0, null);
  return {
    triageQueue,
    collected: pf.collected,
    passed: pf.passed.length,
    discards: pf.discards,
    message:
      pf.passed.length > triageQueue.length
        ? `${pf.passed.length} tweets na janela, mostrando os ${triageQueue.length} de maior ISV (aumente maxBatch em settings pra ver mais).`
        : undefined,
    sessionId,
  };
}

// Fase 2: dado um subset de tweets (selecionados na triagem), chama o LLM e
// devolve replies. So gasta tokens nos tweets que o analista pegou.
// sessionId vem do runTriage e e usado pra atualizar a row de session_logs.
export async function generateRepliesForSelected(
  workspace: Workspace,
  selected: EnrichedTweet[],
  options?: { sessionId?: SessionId; triageMode?: "list" | "swipe" }
): Promise<RefreshOutcome> {
  const { config, id: workspaceId } = workspace;
  const now = Date.now();
  const sessionId = options?.sessionId ?? null;

  // atualiza triage_selected + mode no session log
  if (sessionId) {
    await recordTriage(
      sessionId,
      selected.length, // passado anteriormente sera sobrescrito pelo numero atual
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
        { tweets: selected.map(toPayloadTweet) },
        config
      );
    } catch (e) {
      await recordError(sessionId, "llm", (e as Error).message ?? "llm falhou");
      throw e;
    }
    const llmMs = Date.now() - llmStart;
    const cost = estimateCost(
      config.llm_provider,
      model,
      llmResult.usage.input_tokens,
      llmResult.usage.output_tokens
    );
    llmUsage = {
      input_tokens: llmResult.usage.input_tokens,
      output_tokens: llmResult.usage.output_tokens,
      cost_usd: cost,
    };
    await recordLLM(sessionId, {
      provider: config.llm_provider,
      model,
      ms: llmMs,
      input_tokens: llmResult.usage.input_tokens,
      output_tokens: llmResult.usage.output_tokens,
      cost_usd: cost,
      replies_generated: llmResult.output.results.length,
    });
    track(
      "llm_called",
      {
        provider: config.llm_provider,
        model,
        ms: llmMs,
        tweets_in: selected.length,
        results: llmResult.output.results.length,
        has_voice: Boolean(config.voice?.trim()),
        source: "triage_selected",
        input_tokens: llmResult.usage.input_tokens,
        output_tokens: llmResult.usage.output_tokens,
        cost_usd: cost,
      },
      workspaceId
    );
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

  const fetchStart = Date.now();
  const raw = dedupById(
    await fetchListTweets(config.listId, twitterKey, sinceMs)
  );
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
      { tweets: toSend.map(toPayloadTweet) },
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
  const { config, id: workspaceId } = workspace;
  const now = Date.now();

  const idMatch = tweetUrl.match(/status\/(\d+)/);
  const tweetId = idMatch ? idMatch[1] : tweetUrl.trim();
  if (!/^\d+$/.test(tweetId)) {
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
    track(
      "llm_called",
      {
        provider: config.llm_provider,
        model: config.llm_provider === "anthropic" ? config.model : "gemini-2.5-flash",
        ms: Date.now() - llmStart,
        tweets_in: 1,
        results: llmResult.output.results.length,
        has_voice: Boolean(config.voice?.trim()),
        source: "quick_test",
        input_tokens: llmResult.usage.input_tokens,
        output_tokens: llmResult.usage.output_tokens,
      },
      workspaceId
    );
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

  return {
    collected: 1,
    passed: rendered.length,
    rendered,
    discards: emptyDiscards(),
    skillSummary,
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
