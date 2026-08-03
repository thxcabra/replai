import { ApiError, friendlyHttpMessage } from "./errors";
import type { RawTweet, TweetMedia, TwitterListResponse } from "./types";
import { parseTweetDate } from "./util";

// V4.1.1: composite viral score pra ranquear tweets. Pondera engajamento
// real-world: replies vale 3x like (sinal mais forte de discussao),
// quote 4x (sinal mais forte ainda), RT 2x. View nao entra (inflado por
// algoritmo, nao por interesse).
export function viralScore(raw: RawTweet | undefined | null): number {
  if (!raw?.engagement) return 0;
  const e = raw.engagement;
  return (
    (e.likeCount ?? 0) +
    (e.retweetCount ?? 0) * 2 +
    (e.replyCount ?? 0) * 3 +
    (e.quoteCount ?? 0) * 4
  );
}

// Em producao (extensao) chama a API direto. No preview do browser, o Vite
// injeta VITE_TWITTERAPI_BASE apontando pro proxy local (contorna CORS).
const BASE = import.meta.env.VITE_TWITTERAPI_BASE ?? "https://api.twitterapi.io";

// V4.1: parse media (foto/video/gif) do retorno da TwitterAPI.io.
// A API segue layout estilo Twitter v1: entities.media[] ou extendedEntities.media[].
// Tenta ambos e dedupe por url. Tweets sem media retornam undefined (nao [])
// pra economizar bytes no JSON do payload LLM.
interface RawTwitterMediaItem {
  type?: string;
  media_url_https?: string;
  media_url?: string;
  display_url?: string;
  video_info?: {
    variants?: Array<{ content_type?: string; url?: string; bitrate?: number }>;
  };
  sizes?: Record<string, { w?: number; h?: number }>;
}

function pickMediaUrl(item: RawTwitterMediaItem): string | null {
  // foto: media_url_https. video/gif: maior bitrate do video_info.variants
  if (item.type === "video" || item.type === "animated_gif") {
    const v = item.video_info?.variants
      ?.filter((v) => v.content_type?.startsWith("video/"))
      ?.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))?.[0];
    if (v?.url) return v.url;
  }
  return item.media_url_https ?? item.media_url ?? null;
}

function parseMediaFromRaw(raw: unknown): TweetMedia[] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const extended = r.extendedEntities as
    | { media?: RawTwitterMediaItem[] }
    | undefined;
  const entities = r.entities as
    | { media?: RawTwitterMediaItem[] }
    | undefined;
  const arr = extended?.media ?? entities?.media ?? [];
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  const result: TweetMedia[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    const url = pickMediaUrl(item);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const type: TweetMedia["type"] =
      item.type === "video"
        ? "video"
        : item.type === "animated_gif"
          ? "gif"
          : "photo";
    const large = item.sizes?.large;
    result.push({
      type,
      url,
      // pra video/gif, thumbnail = media_url_https da imagem de preview
      thumbnailUrl:
        type !== "photo"
          ? (item.media_url_https ?? item.media_url ?? undefined)
          : undefined,
      width: large?.w,
      height: large?.h,
    });
  }
  return result.length > 0 ? result : undefined;
}

// V4.1.1: parse engagement metrics. TwitterAPI.io devolve campos snake_case
// em alguns endpoints e camelCase em outros — tenta ambos.
function parseEngagement(raw: unknown): RawTweet["engagement"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const e: RawTweet["engagement"] = {};
  // V4.1.14 (WR-11): rejeita negativos. Counts vem de upstream paid mas
  // valor negativo nunca faz sentido em metricas de engagement — corromper-ia
  // viralScore (sum-of-counts) e ranking inteiro.
  const getNum = (key: string): number | undefined => {
    const v = r[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
    if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
    return undefined;
  };
  e.likeCount =
    getNum("likeCount") ?? getNum("favorite_count") ?? getNum("like_count");
  e.retweetCount = getNum("retweetCount") ?? getNum("retweet_count");
  e.replyCount = getNum("replyCount") ?? getNum("reply_count");
  e.quoteCount = getNum("quoteCount") ?? getNum("quote_count");
  e.viewCount = getNum("viewCount") ?? getNum("view_count");
  e.bookmarkCount = getNum("bookmarkCount") ?? getNum("bookmark_count");
  // remove undefineds
  const hasAny = Object.values(e).some((v) => typeof v === "number");
  return hasAny ? e : undefined;
}

// Normaliza um RawTweet bruto vindo da API: anexa .media e .engagement, propaga
// pra quoted/retweeted/parent recursivamente (1 nivel).
export function normalizeRawTweet(raw: RawTweet | null | undefined): RawTweet | null | undefined {
  if (!raw) return raw;
  const media = parseMediaFromRaw(raw);
  const engagement = parseEngagement(raw);
  const normalized: RawTweet = { ...raw };
  if (media) normalized.media = media;
  if (engagement) normalized.engagement = engagement;
  if (raw.quoted_tweet) {
    normalized.quoted_tweet = normalizeRawTweet(raw.quoted_tweet) ?? null;
  }
  if (raw.retweeted_tweet) {
    normalized.retweeted_tweet = normalizeRawTweet(raw.retweeted_tweet) ?? null;
  }
  return normalized;
}

async function fetchPage(
  listId: string,
  apiKey: string,
  cursor?: string
): Promise<TwitterListResponse> {
  let url = `${BASE}/twitter/list/tweets_timeline?listId=${encodeURIComponent(
    listId
  )}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { "X-API-Key": apiKey },
    });
  } catch {
    throw new ApiError(
      "twitter",
      "Falha de rede ao chamar a TwitterAPI. Cheque sua conexao."
    );
  }

  if (!response.ok) {
    throw new ApiError(
      "twitter",
      friendlyHttpMessage("twitter", response.status),
      response.status
    );
  }

  try {
    return (await response.json()) as TwitterListResponse;
  } catch {
    throw new ApiError("twitter", "Resposta da TwitterAPI nao e JSON valido.");
  }
}

// Busca varios tweets por ID numa unica request (chunked em lotes de 100).
// Usado pra enriquecer replies com o texto do tweet pai (a API devolve so
// inReplyToId/Username inline, nao o texto). Custo: $0.00015 por tweet
// retornado, despresivel pra uma sessao tipica (~5-15 replies).
export async function fetchTweetsBatch(
  tweetIds: string[],
  apiKey: string
): Promise<RawTweet[]> {
  if (tweetIds.length === 0) return [];
  const CHUNK = 100;
  const all: RawTweet[] = [];

  for (let i = 0; i < tweetIds.length; i += CHUNK) {
    const chunk = tweetIds.slice(i, i + CHUNK);
    const url = `${BASE}/twitter/tweets?tweet_ids=${encodeURIComponent(
      chunk.join(",")
    )}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { "X-API-Key": apiKey },
      });
    } catch {
      throw new ApiError(
        "twitter",
        "Falha de rede ao chamar a TwitterAPI. Cheque sua conexao."
      );
    }
    if (!response.ok) {
      throw new ApiError(
        "twitter",
        friendlyHttpMessage("twitter", response.status),
        response.status
      );
    }
    try {
      const data = (await response.json()) as TwitterListResponse;
      if (data.message && !data.tweets) {
        throw new ApiError("twitter", `TwitterAPI: ${data.message}`);
      }
      if (Array.isArray(data.tweets)) {
        all.push(...data.tweets.map((t) => normalizeRawTweet(t) as RawTweet));
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError("twitter", "Resposta da TwitterAPI nao e JSON valido.");
    }
  }

  return all;
}

// Busca um tweet especifico por ID. Usado pelo quick test: o analista cola
// uma URL de tweet pra testar a pipeline naquele post sem esperar ele aparecer
// na Lista.
export async function fetchTweetById(
  tweetId: string,
  apiKey: string
): Promise<RawTweet | null> {
  const url = `${BASE}/twitter/tweets?tweet_ids=${encodeURIComponent(tweetId)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { "X-API-Key": apiKey },
    });
  } catch {
    throw new ApiError(
      "twitter",
      "Falha de rede ao chamar a TwitterAPI. Cheque sua conexao."
    );
  }
  if (!response.ok) {
    throw new ApiError(
      "twitter",
      friendlyHttpMessage("twitter", response.status),
      response.status
    );
  }
  try {
    const data = (await response.json()) as TwitterListResponse;
    if (data.message && !data.tweets) {
      throw new ApiError("twitter", `TwitterAPI: ${data.message}`);
    }
    const first = data.tweets?.[0];
    if (!first) return null;
    return normalizeRawTweet(first) as RawTweet;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("twitter", "Resposta da TwitterAPI nao e JSON valido.");
  }
}

// Puxa tweets da Lista (ordenados do mais recente pro mais antigo), paginando
// ate cruzar a janela de tempo (sinceMs) ou bater o teto de paginas.
// Como vem newest-first, paramos assim que a pagina ja contem tweets mais
// velhos que a janela: isso evita pagar por historico irrelevante.
export async function fetchListTweets(
  listId: string,
  apiKey: string,
  sinceMs: number,
  maxPages = 4
): Promise<RawTweet[]> {
  const all: RawTweet[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const data = await fetchPage(listId, apiKey, cursor);

    if (!Array.isArray(data.tweets)) {
      if (data.message) throw new ApiError("twitter", `TwitterAPI: ${data.message}`);
      break;
    }
    if (data.tweets.length === 0) break;

    all.push(...data.tweets.map((t) => normalizeRawTweet(t) as RawTweet));

    // o ultimo da pagina e o mais antigo; se ja passou da janela, paramos
    const oldest = data.tweets[data.tweets.length - 1];
    const oldestMs = parseTweetDate(oldest?.createdAt);
    if (oldestMs !== null && oldestMs < sinceMs) break;

    if (!data.has_next_page || !data.next_cursor) break;
    cursor = data.next_cursor;
  }

  return all;
}
