import { ApiError } from "./errors";
import { loadGraph } from "./graph";
import { ANTHROPIC_API_KEY, GEMINI_API_KEY, TWITTERAPI_KEY } from "./keys";
import { generateReplies } from "./llm";
import { buildContext, emptyDiscards, prefilter } from "./prefilter";
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

// Uma sessao: busca os tweets da janela (ultimas N horas), filtra, e devolve o
// conjunto completo. Cada chamada RESETA (nao acumula com a sessao anterior).
// Opera sobre o workspace ativo: usa o config dele e carrega o grafo dele.
export async function runRefresh(workspace: Workspace): Promise<RefreshOutcome> {
  const { config, id: workspaceId } = workspace;
  const now = Date.now();
  const sinceMs = now - config.timeWindowHours * 60 * 60 * 1000;

  const twitterKey = config.twitterapi_key.trim() || TWITTERAPI_KEY;
  if (!twitterKey) {
    throw new ApiError(
      "twitter",
      "Configure a chave da TwitterAPI nas configuracoes (twitterapi.io) ou no .env."
    );
  }

  const raw = dedupById(
    await fetchListTweets(config.listId, twitterKey, sinceMs)
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
    const output = await generateReplies(
      { tweets: toSend.map(toPayloadTweet) },
      config
    );
    const byId = new Map<string, EnrichedTweet>(
      toSend.map((t) => [t.tweet_id, t])
    );
    rendered = output.results
      .map((result) => {
        const tweet = byId.get(result.tweet_id);
        return tweet ? { tweet, result } : null;
      })
      .filter((x): x is RenderedTweet => x !== null);
    skillSummary = output.summary;
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
    const output = await generateReplies(
      { tweets: [toPayloadTweet(enriched)] },
      config
    );
    rendered = output.results.map((result) => ({ tweet: enriched, result }));
    skillSummary = output.summary;
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
