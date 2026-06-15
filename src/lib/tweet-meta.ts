import { parseTweetDate } from "./util";
import type { RawTweet } from "./types";

// Helpers puros pra extrair metadata do RawTweet pro payload do pushReplyLog.
// Centraliza o mapping RawTweet -> reply_logs columns. Cada funcao retorna
// um subset com as colunas que ela cobre.

export interface AuthorMeta {
  tweet_author_followers: number | null;
  tweet_author_is_automated: boolean | null;
  tweet_author_verified: boolean | null;
  tweet_author_display_name: string | null;
}

export function extractAuthorMeta(raw: RawTweet): AuthorMeta {
  const author = raw.author;
  return {
    tweet_author_followers: author?.followers ?? null,
    tweet_author_is_automated: author?.isAutomated ?? null,
    // verified e display_name nao vem do tipo RawTweetAuthor atual; ficam null
    // ate twitterapi.ts ser estendido pra capturar.
    tweet_author_verified: null,
    tweet_author_display_name: null,
  };
}

export interface TimingMeta {
  tweet_created_at: string | null;
  tweet_age_minutes: number | null;
}

export function extractTiming(raw: RawTweet, nowMs: number): TimingMeta {
  const createdMs = parseTweetDate(raw.createdAt);
  if (createdMs === null) {
    return { tweet_created_at: null, tweet_age_minutes: null };
  }
  return {
    tweet_created_at: new Date(createdMs).toISOString(),
    tweet_age_minutes: Math.max(0, Math.floor((nowMs - createdMs) / 60000)),
  };
}

export interface ThreadMeta {
  tweet_is_reply: boolean | null;
  tweet_in_reply_to_username: string | null;
  tweet_conversation_id: string | null;
  tweet_is_quote: boolean | null;
  tweet_quoted_handle: string | null;
  tweet_quoted_text: string | null;
  tweet_is_limited_reply: boolean | null;
  tweet_thread_size: number | null;
}

export function extractThreadInfo(raw: RawTweet): ThreadMeta {
  const qt = raw.quoted_tweet ?? null;
  // thread size aproximado: 1 (standalone) + 1 se tem parent + 1 se tem QT.
  // Pra valor exato precisariamos walk conversation_id, fora de escopo.
  let threadSize = 1;
  if (raw.parent_tweet) threadSize += 1;
  if (qt) threadSize += 1;
  return {
    tweet_is_reply: raw.isReply ?? null,
    tweet_in_reply_to_username: raw.inReplyToUsername ?? null,
    tweet_conversation_id: raw.conversationId ?? null,
    tweet_is_quote: Boolean(qt),
    tweet_quoted_handle: qt?.author?.userName ?? null,
    tweet_quoted_text: qt?.text ?? null,
    tweet_is_limited_reply: raw.isLimitedReply ?? null,
    tweet_thread_size: threadSize,
  };
}

export interface ContentMeta {
  tweet_char_count: number;
  tweet_has_media: boolean;
  tweet_has_links: boolean;
  tweet_hashtags: string[];
  tweet_mentions: string[];
  tweet_emoji_count: number;
}

// Regex pra emoji (unicode 15.1+). u flag necessaria. Conta pares surrogate
// como 1 emoji (heuristica boa o suficiente pra analytics).
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const URL_RE = /https?:\/\/\S+/i;
const HASHTAG_RE = /#(\w{1,140})/g;
const MENTION_RE = /@(\w{1,15})/g;

export function extractContentMeta(
  text: string,
  rawHasMedia?: boolean
): ContentMeta {
  const t = text ?? "";
  const hashtags: string[] = [];
  for (const m of t.matchAll(HASHTAG_RE)) hashtags.push(m[1].toLowerCase());
  const mentions: string[] = [];
  for (const m of t.matchAll(MENTION_RE)) mentions.push(m[1].toLowerCase());
  const emojiMatches = t.match(EMOJI_RE);
  return {
    tweet_char_count: t.length,
    // RawTweet atual nao expoe media[]; usa flag opcional do caller (futuro:
    // estender twitterapi.ts pra capturar). Default false.
    tweet_has_media: rawHasMedia ?? false,
    tweet_has_links: URL_RE.test(t),
    tweet_hashtags: hashtags,
    tweet_mentions: mentions,
    tweet_emoji_count: emojiMatches?.length ?? 0,
  };
}

// Combina todos os helpers acima. Conveniencia pra App.tsx -> pushReplyLog.
export function extractAllTweetMeta(
  raw: RawTweet | undefined,
  text: string,
  nowMs: number
): AuthorMeta & TimingMeta & ThreadMeta & ContentMeta {
  if (!raw) {
    return {
      ...extractAuthorMeta({} as RawTweet),
      ...extractTiming({} as RawTweet, nowMs),
      ...extractThreadInfo({} as RawTweet),
      ...extractContentMeta(text),
    };
  }
  return {
    ...extractAuthorMeta(raw),
    ...extractTiming(raw, nowMs),
    ...extractThreadInfo(raw),
    ...extractContentMeta(text),
  };
}
