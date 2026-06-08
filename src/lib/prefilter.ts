import type {
  Config,
  DiscardReason,
  EnrichedTweet,
  Graph,
  RawTweet,
} from "./types";
import { lookupHandle } from "./graph";
import {
  isPureRetweetText,
  meaningfulWordCount,
  parseTweetDate,
  textWithoutNoise,
  truncate,
} from "./util";

export interface PrefilterResult {
  passed: EnrichedTweet[];
  collected: number;
  discards: Record<DiscardReason, number>;
}

export function emptyDiscards(): Record<DiscardReason, number> {
  return {
    out_of_window: 0,
    no_text: 0,
    too_short: 0,
    pure_retweet: 0,
    lang_filtered: 0,
    not_in_graph_strict: 0,
    automated: 0,
  };
}

// Exportada pra reuso no quick test (orchestrator.ts), pra ter o mesmo
// context que o prefilter constroi no fluxo principal.
export function buildContext(tweet: RawTweet, graph: Graph): string | null {
  const parts: string[] = [];

  if (tweet.quoted_tweet) {
    const q = tweet.quoted_tweet;
    const qHandle = q.author?.userName ?? "alguem";
    const qText = q.text ? truncate(q.text, 180) : "(sem texto)";
    parts.push(`quoting @${qHandle}: '${qText}'`);
  }

  if (tweet.isReply && tweet.inReplyToUsername) {
    const parentEntry = lookupHandle(graph, tweet.inReplyToUsername);
    const tag = parentEntry?.is_poi === 1 ? " (POI da rede)" : "";
    const parentText = tweet.parent_tweet?.text;
    if (parentText) {
      const pText = truncate(parentText, 180);
      parts.push(`reply to @${tweet.inReplyToUsername}${tag}: '${pText}'`);
    } else {
      parts.push(`reply to @${tweet.inReplyToUsername}${tag}`);
    }
  }

  return parts.length ? parts.join(". ") : null;
}

// Triagem mecanica de uma sessao. Sem dedup entre sessoes: cada atualizar
// reavalia tudo da janela do zero.
export function prefilter(
  tweets: RawTweet[],
  config: Config,
  graph: Graph,
  now: number
): PrefilterResult {
  const discards = emptyDiscards();
  const passed: EnrichedTweet[] = [];
  const windowMs = config.timeWindowHours * 60 * 60 * 1000;

  for (const tweet of tweets) {
    const id = tweet.id;
    if (!id) continue;

    // 1. fora da janela de tempo
    const createdAtMs = parseTweetDate(tweet.createdAt);
    if (createdAtMs !== null && createdAtMs < now - windowMs) {
      discards.out_of_window++;
      continue;
    }

    const text = (tweet.text ?? "").trim();

    // 4. retweet puro sem comentario
    if (tweet.retweeted_tweet && (!text || isPureRetweetText(text))) {
      discards.pure_retweet++;
      continue;
    }

    // 2. sem texto / so URLs e mentions
    if (!text || !textWithoutNoise(text)) {
      discards.no_text++;
      continue;
    }

    // 3. poucas palavras de contexto
    if (meaningfulWordCount(text) < 5) {
      discards.too_short++;
      continue;
    }

    // 5. idioma fora do filtro configurado
    const lang = tweet.lang ?? "";
    if (!config.langs.includes(lang)) {
      discards.lang_filtered++;
      continue;
    }

    // 8. conta automatizada
    if (tweet.author?.isAutomated === true) {
      discards.automated++;
      continue;
    }

    const handle = (tweet.author?.userName ?? "").toLowerCase();
    const entry = lookupHandle(graph, handle);

    // 7. handle fora do grafo e modo strict ligado
    if (!entry && !config.includeUnmapped) {
      discards.not_in_graph_strict++;
      continue;
    }

    passed.push({
      tweet_id: id,
      handle,
      text,
      lang,
      timestamp:
        createdAtMs !== null ? new Date(createdAtMs).toISOString() : undefined,
      isv: entry?.isv ?? 50,
      inferred_layer: entry?.inferred_layer ?? 3,
      is_poi: entry?.is_poi ?? 0,
      context: buildContext(tweet, graph),
      url: tweet.url,
      is_limited_reply: tweet.isLimitedReply === true,
      ...(entry ? {} : { not_in_graph: true }),
    });
  }

  // ordena por ISV desc, POI desempata, layer menor desempata
  passed.sort((a, b) => {
    if (b.isv !== a.isv) return b.isv - a.isv;
    if (b.is_poi !== a.is_poi) return b.is_poi - a.is_poi;
    return a.inferred_layer - b.inferred_layer;
  });

  return { passed, collected: tweets.length, discards };
}
