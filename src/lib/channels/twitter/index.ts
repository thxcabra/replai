// V5 — Twitter channel adapter (shim).
//
// Nao reimplementa nada: apenas converte o output do lib/twitterapi.ts
// pro shape agnostico RawPost. Assim o orchestrator novo pode consumir
// via ChannelAdapter uniforme.
//
// O refactor mecanico completo (renomear RawTweet -> RawPost em types.ts)
// vira depois. Por enquanto este shim mantem o codigo legacy X 100% funcional
// enquanto V5 evolui em paralelo.

import { fetchListTweets } from "../../twitterapi";
import { LIMITS } from "../../constants";
import type {
  Channel,
  ChannelAdapter,
  FetchOptions,
  FetchResult,
  RawPost,
} from "../types";
import type { RawTweet } from "../../types";

const CHANNEL: Channel = "twitter";

function tweetToPost(t: RawTweet): RawPost {
  const media = (t.media ?? []).map((m) => ({
    type: m.type as "photo" | "video" | "gif",
    url: m.url,
    thumbnail_url: m.thumbnailUrl,
  }));
  return {
    channel: CHANNEL,
    post_ref: t.id ?? "",
    author_handle: t.author?.userName ?? "",
    author_display_name: t.author?.userName ?? "",
    text: t.text ?? "",
    lang: t.lang,
    created_at: t.createdAt ?? new Date().toISOString(),
    url: t.url ?? "",
    media,
    engagement: {
      likes: t.engagement?.likeCount,
      comments: t.engagement?.replyCount,
      reshares: t.engagement?.retweetCount,
      quotes: t.engagement?.quoteCount,
      bookmarks: t.engagement?.bookmarkCount,
      impressions: t.engagement?.viewCount,
    },
    context: t.isReply && t.inReplyToId
      ? {
          kind: "reply_to",
          ref: t.inReplyToId,
        }
      : t.quoted_tweet
      ? {
          kind: "quote",
          ref: t.quoted_tweet.id ?? "",
        }
      : undefined,
    raw_meta: t as unknown as Record<string, unknown>,
  };
}

export interface TwitterAdapterConfig {
  listId: string;
  apiKey: string;
  maxPages?: number;
}

export const twitterAdapter: ChannelAdapter = {
  channel: CHANNEL,
  charLimit: LIMITS.X_CHAR_LIMIT,

  async fetchPosts(
    cfg: unknown,
    options: FetchOptions
  ): Promise<FetchResult> {
    const config = cfg as TwitterAdapterConfig;
    const tweets = await fetchListTweets(
      config.listId,
      config.apiKey,
      options.sinceMs,
      config.maxPages
    );
    const posts = tweets.map(tweetToPost);
    return {
      posts,
      cached: false,
      fetchedAt: Date.now(),
    };
  },

  buildReplyIntent(post: RawPost, replyText: string) {
    const url = `https://x.com/intent/post?in_reply_to=${encodeURIComponent(
      post.post_ref
    )}&text=${encodeURIComponent(replyText)}`;
    return {
      kind: "intent_url" as const,
      url,
      needsClipboard: false,
    };
  },
};
