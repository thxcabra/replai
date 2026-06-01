import { TWITTERAPI_KEY } from "./keys";
import { generateReplies } from "./llm";
import { emptyDiscards, prefilter } from "./prefilter";
import { saveSessionCache } from "./storage";
import { fetchListTweets } from "./twitterapi";
import type {
  Config,
  DiscardReason,
  EnrichedTweet,
  PayloadTweet,
  RawTweet,
  RenderedTweet,
  SkillSummary,
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

// Uma sessao: busca os tweets da janela (ultimas N horas), filtra, e devolve o
// conjunto completo. Cada chamada RESETA (nao acumula com a sessao anterior).
export async function runRefresh(config: Config): Promise<RefreshOutcome> {
  const now = Date.now();
  const sinceMs = now - config.timeWindowHours * 60 * 60 * 1000;

  const raw = dedupById(
    await fetchListTweets(config.listId, TWITTERAPI_KEY, sinceMs)
  );

  if (raw.length === 0) {
    const empty = await emptySession(now);
    return { ...empty, message: "Nada na Lista." };
  }

  const pf = prefilter(raw, config, now);

  if (pf.passed.length === 0) {
    const empty = await emptySession(now, pf.collected);
    return {
      ...empty,
      discards: pf.discards,
      message: `${pf.collected} tweets na janela, nenhum passou nos filtros (retweets, idioma, etc.).`,
    };
  }

  const toSend = pf.passed.slice(0, config.maxBatch);
  const overflow = pf.passed.length - toSend.length;

  let rendered: RenderedTweet[];
  let skillSummary: SkillSummary | undefined;

  if (config.dryRun) {
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

  await saveSessionCache({
    timestamp: now,
    collected: pf.collected,
    passed: rendered.length,
    rendered,
  });

  let message: string | undefined;
  if (config.dryRun) {
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

async function emptySession(
  now: number,
  collected = 0
): Promise<RefreshOutcome> {
  await saveSessionCache({ timestamp: now, collected, passed: 0, rendered: [] });
  return {
    collected,
    passed: 0,
    rendered: [],
    discards: emptyDiscards(),
  };
}
