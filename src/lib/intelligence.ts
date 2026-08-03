import { supabase } from "./supabase";
import { getSession } from "./auth";
import { notifySyncError } from "./storage";
import {
  getCachedAnalysis,
  getCachedAuthor,
  hashAnalysisKey,
  setCachedAnalysis,
  setCachedAuthors,
} from "./intelligence-cache";
import type {
  AuthorProfile,
  AuthorTier,
  BatchRelations,
  EnrichedTweet,
  IntelligenceBundle,
  PostAnalysis,
} from "./types";

// V4.1 — Camada de inteligencia cross-data. Tres sub-camadas:
//
// A. analyzePost: extracao local (regex) de entities, topics, claim_type,
//    engagement_hooks, data_gaps. Sem LLM no MVP (V4.1) — futuro pode
//    chamar Gemini Flash pra topics semanticos.
//
// B. getAuthorProfile: query batched ao Supabase pra historico do analista
//    com cada autor. Cooldown, engagement_back_rate, successful_categories.
//
// C. detectBatchRelations: padroes locais cross-tweet do refresh atual.
//    Hot topics, co-mentions, sem LLM.

// ---- Sub-camada A: analyzePost ----

const MENTION_RE = /(?<![@\w])@([A-Za-z0-9_]{1,15})/g;
const TICKER_RE = /\$([A-Z]{1,6})\b/g;
const HASHTAG_RE = /#([\p{L}\p{N}_]+)/gu;
const URL_RE = /https?:\/\/[^\s)\]]+/g;

// Heuristicas leves de claim_type. Cobertura ~60-70%, fallback "unknown".
function inferClaimType(text: string): PostAnalysis["claim_type"] {
  const t = text.trim();
  if (!t) return "unknown";
  // Perguntas
  if (/\?\s*$/.test(t)) return "question";
  if (/^(why|how|what|when|where|who|porque|por que|como|o que|quando|onde|quem)\b/i.test(t))
    return "question";
  // Anuncios
  if (/\b(launching|announcing|introducing|today we|hoje a gente|lancamos|lancando|anunciar)\b/i.test(t))
    return "announcement";
  // Joke / sarcasm (sinais fracos)
  if (/^(lol|kkk|haha|kk|hahaha)/i.test(t)) return "joke";
  // Thread (1/, 2/, etc)
  if (/^\d+\/\d+|^\d+\/\s/.test(t)) return "thread_continuation";
  // Personal vs opinion vs fact
  if (/\b(i am|i'm|eu (sou|estou|to)|gosto de|adoro|odeio)\b/i.test(t))
    return "personal";
  // Tem numero/percentual citado → provavel fact_claim
  if (/\b\d+(\.\d+)?\s*(%|x|million|million|bn|billion|mil|milhao|bilhao)\b/i.test(t))
    return "fact_claim";
  // default
  return "opinion";
}

function detectHooks(text: string): PostAnalysis["engagement_hooks"] {
  const hasOpenQuestion = /\?\s*$/.test(text.trim());
  // pollable = afirmacao polemica, ex: "X e melhor que Y", "everyone should..."
  const hasPollableClaim =
    /\b(everyone should|todo mundo deveria|melhor que|worse than|sempre|nunca|never|always)\b/i.test(
      text
    );
  return {
    has_open_question: hasOpenQuestion,
    has_pollable_claim: hasPollableClaim,
  };
}

function detectGaps(tweet: EnrichedTweet): string[] {
  const gaps: string[] = [];
  if (!tweet.raw_meta?.author?.followers) gaps.push("author_followers");
  if (tweet.not_in_graph) gaps.push("author_grafo_metrics");
  if (!tweet.context) gaps.push("thread_parent_or_quote");
  if (!tweet.media || tweet.media.length === 0) gaps.push("visual_context");
  return gaps;
}

// Topics: heuristica MUITO leve baseada em keyword matching. MVP suficiente
// pra detectBatchRelations achar hot topics. V4.2 pode trocar por Gemini Flash.
// V4.1.14 (WR-13): regex agora exige contextos especificos. Antes `\bai\b`
// e `\bllama\b` pegavam tweets fora de tema (animal "llama", siglas curtas).
// Pra termos genericos (ai, ml, vc) exige co-ocorrencia ou variantes longas.
const TOPIC_KEYWORDS: { topic: string; keywords: RegExp }[] = [
  {
    topic: "ai-llm",
    keywords:
      /\b(gpt-?\d|llm|claude|gemini|mistral|llama\s*(?:2|3|model|paper)|chatgpt|inteligencia artificial|machine learning|deep learning)\b/i,
  },
  {
    topic: "macro-fed",
    keywords:
      /\b(fed|federal reserve|inflation|inflacao|rate cut|cpi|fomc|powell|yield)\b/i,
  },
  {
    topic: "crypto",
    keywords:
      /\b(bitcoin|btc|eth|ethereum|crypto|defi|web3|stablecoin)\b/i,
  },
  {
    topic: "startup-fundraise",
    keywords:
      /\b(seed round|series\s?[abc]|raised\s+\$|raise of|funding round|investors?|venture capital|valuation)\b/i,
  },
  {
    topic: "product-launch",
    keywords:
      /\b(launching|introducing|today we|lancamos|new feature|just shipped)\b/i,
  },
  {
    topic: "hiring",
    keywords:
      /\b(hiring|we are hiring|we're looking for|contratando|vagas?|job opening|open role)\b/i,
  },
  {
    topic: "engineering",
    keywords:
      /\b(typescript|python|rust|golang|kubernetes|docker|postgres|database|backend|frontend)\b/i,
  },
  {
    topic: "design-ux",
    keywords:
      /\b(design|ux|figma|interface|wireframe|prototype)\b/i,
  },
  {
    topic: "fintech",
    keywords:
      /\b(fintech|payment|paypal|stripe|banking|loan|credit card)\b/i,
  },
  {
    topic: "marketing-growth",
    keywords:
      /\b(growth|cac|ltv|funnel|marketing|brand|seo|content marketing)\b/i,
  },
];

function inferTopics(text: string): string[] {
  const seen = new Set<string>();
  for (const t of TOPIC_KEYWORDS) {
    if (t.keywords.test(text)) seen.add(t.topic);
  }
  return Array.from(seen);
}

export async function analyzePost(
  tweet: EnrichedTweet
): Promise<PostAnalysis> {
  const text = tweet.text ?? "";
  const cacheKey = hashAnalysisKey(tweet.tweet_id, text);
  const cached = await getCachedAnalysis(cacheKey);
  if (cached) return cached;

  const mentions = Array.from(text.matchAll(MENTION_RE)).map((m) =>
    m[1].toLowerCase()
  );
  const tickers = Array.from(text.matchAll(TICKER_RE)).map((m) =>
    m[1].toUpperCase()
  );
  const hashtags = Array.from(text.matchAll(HASHTAG_RE)).map((m) =>
    m[1].toLowerCase()
  );
  const urls = Array.from(text.matchAll(URL_RE))
    .map((m) => m[0])
    .filter((u) => !/^https?:\/\/(x|twitter)\.com\//i.test(u));

  const analysis: PostAnalysis = {
    entities: {
      mentions: Array.from(new Set(mentions)),
      tickers: Array.from(new Set(tickers)),
      urls: Array.from(new Set(urls)),
      hashtags: Array.from(new Set(hashtags)),
    },
    topics: inferTopics(text),
    claim_type: inferClaimType(text),
    engagement_hooks: detectHooks(text),
    data_gaps: detectGaps(tweet),
  };
  await setCachedAnalysis(cacheKey, analysis);
  return analysis;
}

// ---- Sub-camada B: getAuthorProfile (batched) ----

export async function getAuthorProfiles(
  handles: string[]
): Promise<Map<string, AuthorProfile>> {
  const result = new Map<string, AuthorProfile>();
  if (handles.length === 0) return result;
  const lower = Array.from(new Set(handles.map((h) => h.toLowerCase())));

  // tenta cache primeiro pra cada handle
  const missing: string[] = [];
  for (const h of lower) {
    const cached = await getCachedAuthor(h);
    if (cached) {
      result.set(h, cached);
    } else {
      missing.push(h);
    }
  }
  if (missing.length === 0) return result;

  // sem sessao = nao tem como queryar Supabase com RLS. Marca todos como
  // first_contact e segue.
  const session = await getSession();
  if (!session?.user?.id) {
    for (const h of missing) {
      result.set(h, makeEmptyProfile(h));
    }
    return result;
  }

  try {
    const { data, error } = await supabase.rpc("get_author_profiles", {
      handles: missing,
    });
    if (error) {
      console.warn("[intelligence] get_author_profiles RPC error:", error);
      // V4.1.14 (WR-07): surfacea no banner em vez de falhar silenciosamente
      notifySyncError("intelligence.get_author_profiles", error);
      // fallback: trata todos como first_contact
      for (const h of missing) {
        result.set(h, makeEmptyProfile(h));
      }
      return result;
    }
    const rows = (data as
      | Array<{
          author_handle: string;
          interaction_count: number;
          we_posted_count: number;
          we_verified_count: number;
          author_engaged_count: number;
          last_interaction_at: string | null;
          successful_categories: string[] | null;
          avg_relevance: number | null;
          avg_engagement: number | null;
        }>
      | null) ?? [];
    const present = new Set<string>();
    const fresh: AuthorProfile[] = [];
    for (const row of rows) {
      const handle = row.author_handle.toLowerCase();
      present.add(handle);
      const engagementBackRate =
        row.we_posted_count > 0
          ? row.author_engaged_count / row.we_posted_count
          : 0;
      // cooldown: respondemos 3+ vezes nos ultimos 30 dias sem o autor engajar
      const last = row.last_interaction_at
        ? new Date(row.last_interaction_at).getTime()
        : 0;
      const within30d =
        last > 0 && Date.now() - last < 30 * 24 * 60 * 60 * 1000;
      const cooldown =
        within30d &&
        row.we_posted_count >= 3 &&
        row.author_engaged_count === 0;
      const profile: AuthorProfile = {
        handle,
        interaction_count: Number(row.interaction_count ?? 0),
        we_posted_count: Number(row.we_posted_count ?? 0),
        we_verified_count: Number(row.we_verified_count ?? 0),
        author_engaged_count: Number(row.author_engaged_count ?? 0),
        engagement_back_rate: engagementBackRate,
        last_interaction_at: row.last_interaction_at,
        successful_categories: row.successful_categories ?? [],
        cooldown_recommended: cooldown,
        is_first_contact: false,
        avg_relevance: row.avg_relevance,
        avg_engagement: row.avg_engagement,
      };
      result.set(handle, profile);
      fresh.push(profile);
    }
    // handles SEM historico → first_contact
    for (const h of missing) {
      if (!present.has(h)) {
        const empty = makeEmptyProfile(h);
        result.set(h, empty);
        fresh.push(empty);
      }
    }
    await setCachedAuthors(fresh);
  } catch (e) {
    console.warn("[intelligence] getAuthorProfiles falhou:", e);
    // V4.1.14 (WR-07): surfacea no banner pra analista saber que o
    // engagement scoring/intelligence esta degradado.
    notifySyncError("intelligence.getAuthorProfiles", e);
    for (const h of missing) {
      result.set(h, makeEmptyProfile(h));
    }
  }
  return result;
}

function makeEmptyProfile(handle: string): AuthorProfile {
  return {
    handle,
    interaction_count: 0,
    we_posted_count: 0,
    we_verified_count: 0,
    author_engaged_count: 0,
    engagement_back_rate: 0,
    last_interaction_at: null,
    successful_categories: [],
    cooldown_recommended: false,
    is_first_contact: true,
    avg_relevance: null,
    avg_engagement: null,
  };
}

// ---- Sub-camada C: detectBatchRelations ----

export function detectBatchRelations(
  enriched: EnrichedTweet[]
): BatchRelations {
  // Conta topicos no batch
  const topicCount = new Map<string, number>();
  for (const t of enriched) {
    const topics = t.intelligence?.analysis.topics ?? [];
    for (const topic of topics) {
      topicCount.set(topic, (topicCount.get(topic) ?? 0) + 1);
    }
  }
  // Hot = aparece em 2+ tweets do batch
  const hot_topics = Array.from(topicCount.entries())
    .filter(([, count]) => count >= 2)
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count);

  // Co-mentions: entidades (mentions + tickers) citadas por multiplos autores
  const entityToAuthors = new Map<string, Set<string>>();
  for (const t of enriched) {
    const handle = t.handle.toLowerCase();
    const mentions = t.intelligence?.analysis.entities.mentions ?? [];
    const tickers = t.intelligence?.analysis.entities.tickers ?? [];
    const all = [
      ...mentions.map((m) => `@${m}`),
      ...tickers.map((t) => `$${t}`),
    ];
    for (const entity of all) {
      if (!entityToAuthors.has(entity)) {
        entityToAuthors.set(entity, new Set());
      }
      entityToAuthors.get(entity)!.add(handle);
    }
  }
  const co_mentioned_entities = Array.from(entityToAuthors.entries())
    .filter(([, authors]) => authors.size >= 2)
    .map(([entity, authors]) => ({
      entity,
      by_authors: Array.from(authors),
    }))
    .sort((a, b) => b.by_authors.length - a.by_authors.length);

  return { hot_topics, co_mentioned_entities };
}

// ---- API integrada: enrichWithIntelligence ----

// Funcao principal usada pelo orchestrator. Roda as 3 sub-camadas e
// devolve EnrichedTweet[] com `.intelligence` populado.
export async function enrichWithIntelligence(
  tweets: EnrichedTweet[]
): Promise<EnrichedTweet[]> {
  if (tweets.length === 0) return tweets;

  // Sub-camada A: analisa cada post (paralelo, todos cached/local)
  const analyses = await Promise.all(tweets.map((t) => analyzePost(t)));

  // Sub-camada B: profile dos autores (batched call ao Supabase)
  const handles = tweets.map((t) => t.handle);
  const profiles = await getAuthorProfiles(handles);

  // Anexa intelligence bundle preliminar (sem batch_signals ainda — precisa
  // de todos os tweets enriched primeiro)
  const interim = tweets.map((t, i) => ({
    ...t,
    intelligence: {
      analysis: analyses[i],
      author_profile: profiles.get(t.handle.toLowerCase()),
    } as IntelligenceBundle,
  }));

  // Sub-camada C: relacoes cross-batch (precisa de intelligence ja populado)
  const relations = detectBatchRelations(interim);
  const hotTopicSet = new Set(relations.hot_topics.map((h) => h.topic));
  const coMentionSet = new Set(
    relations.co_mentioned_entities.flatMap((c) => c.by_authors)
  );

  return interim.map((t) => ({
    ...t,
    intelligence: {
      ...t.intelligence!,
      batch_signals: {
        is_part_of_hot_topic: (
          t.intelligence!.analysis.topics ?? []
        ).some((topic) => hotTopicSet.has(topic)),
        co_mentioned_with_others: coMentionSet.has(t.handle.toLowerCase()),
      },
    },
  }));
}

// ---- Derivacao do AuthorTier (usado por 2.10) ----

export function deriveAuthorTier(
  isv: number,
  followers?: number
): AuthorTier {
  // ISV e o sinal principal (0-100). Followers reforca quando disponivel.
  if (isv >= 90 || (followers ?? 0) >= 500_000) return "mega";
  if (isv >= 70 || (followers ?? 0) >= 50_000) return "large";
  if (isv >= 40) return "mid";
  return "small";
}
