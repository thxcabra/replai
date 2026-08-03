// V5 — LinkedIn channel adapter.
//
// Watchlist = bridges "ready + in_context" do bundle Groundswell ativo.
// Fetch = APIFY actor pra posts das bridges, via Edge Function proxy.
// Reply UX = clipboard + abrir post (LinkedIn nao tem intent URL publica).

import { APIFY, LIMITS } from "../../constants";
import { getActiveBridges, getActiveBundle } from "../../groundswell/storage";
import { apifyFetch } from "./apify-client";
import type {
  BridgeFetchTarget,
  Channel,
  ChannelAdapter,
  FetchOptions,
  FetchResult,
  RawPost,
} from "../types";

const CHANNEL: Channel = "linkedin";

// Actor default — apimaestro/linkedin-profile-posts (popular, ~$5/1000 posts).
// Trocar pra outro actor da allowlist se ele mudar de preco/deprecar.
const DEFAULT_ACTOR = APIFY.LINKEDIN_POSTS_ACTOR;

// ---- Normalizer tolerante ----
//
// Cada actor da APIFY retorna shape ligeiramente diferente. Ao inves de tipar
// forte, extraimos campos por multiplos alias possiveis. Se algum campo faltar,
// usa fallback vazio. `raw_meta` preserva tudo pra debug/analise.

type MaybePrimitive = string | number | boolean | null | undefined;

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  const v = pick(obj, keys);
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  const v = pick(obj, keys);
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[,.]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function normalizeLinkedInPost(
  raw: Record<string, unknown>,
  fetchedViaProfile?: string
): RawPost | null {
  // ---- Post identity ----
  // apimaestro/linkedin-profile-posts usa `full_urn` (urn:li:ugcPost:...)
  // como identidade canonica. Fallback pra outros actors.
  const urnObj = (raw.urn ?? {}) as Record<string, unknown>;
  const post_ref =
    pickString(raw, ["full_urn"]) ??
    pickString(urnObj, ["activity_urn", "ugcPost_urn", "share_urn"]) ??
    pickString(raw, ["activityUrn", "postUrn", "id", "postId"]) ??
    pickString(raw, ["url", "postUrl", "linkedinUrl"]) ??
    "";
  if (!post_ref) return null;

  // ---- Text ----
  const text =
    pickString(raw, ["text", "content", "postContent", "commentary", "description"]) ??
    "";

  // ---- Author ----
  const authorObj = (raw.author ??
    raw.postAuthor ??
    raw.profileInfo ??
    {}) as Record<string, unknown>;

  const firstName = pickString(authorObj, ["first_name", "firstName"]);
  const lastName = pickString(authorObj, ["last_name", "lastName"]);
  const authorDisplay =
    pickString(authorObj, ["name", "fullName", "displayName"]) ??
    [firstName, lastName].filter(Boolean).join(" ") ??
    pickString(raw, ["authorName", "author_name"]) ??
    "";

  const authorHandleRaw =
    pickString(authorObj, [
      "username",
      "publicIdentifier",
      "public_identifier",
      "handle",
    ]) ??
    pickString(raw, ["authorHandle", "author_handle", "username"]) ??
    extractHandleFromUrl(
      pickString(authorObj, ["profile_url", "profileUrl", "linkedinUrl", "url"]) ??
        fetchedViaProfile
    );

  // Decode URL-encoded handles (LinkedIn representa "joao" com cedilha como "jo%C3%A3o")
  const authorHandle = authorHandleRaw
    ? safeDecodeUri(authorHandleRaw)
    : "";

  const authorHeadline = pickString(authorObj, [
    "headline",
    "title",
    "position",
    "subtitle",
  ]);
  const authorAvatarUrl = pickString(authorObj, [
    "profile_picture",
    "profilePicture",
    "profilePictureUrl",
    "avatarUrl",
    "imageUrl",
    "picture",
  ]);

  // ---- Timestamps ----
  // apimaestro: `posted_at.date` (formato "YYYY-MM-DD HH:MM:SS") + `posted_at.timestamp` (ms)
  const postedAtObj = (raw.posted_at ?? raw.postedAt ?? {}) as Record<string, unknown>;
  const created =
    parseApimaestroDate(pickString(postedAtObj, ["date"])) ??
    tsToIso(pickNumber(postedAtObj, ["timestamp"])) ??
    pickString(raw, ["publishedAt", "postedAt", "date", "postedAtIso", "createdAt", "timestamp"]) ??
    new Date().toISOString();

  // ---- URL ----
  const postUrl =
    pickString(raw, ["url", "postUrl", "linkedinUrl", "shareUrl"]) ?? "";

  // ---- Media ----
  const media: RawPost["media"] = [];
  const mediaObj = (raw.media ?? {}) as Record<string, unknown>;
  const mediaType = pickString(mediaObj, ["type"]);
  // apimaestro: media.images[] com {url, width, height}
  const imagesArr = mediaObj.images;
  if (Array.isArray(imagesArr)) {
    for (const item of imagesArr) {
      if (item && typeof item === "object") {
        const mObj = item as Record<string, unknown>;
        const url = pickString(mObj, ["url", "src", "imageUrl"]);
        if (url) media.push({ type: "photo", url });
      }
    }
  }
  // media.type == "video": media.url e o video
  if (mediaType === "video") {
    const vUrl = pickString(mediaObj, ["url"]);
    const thumb = pickString(mediaObj, ["thumbnail"]);
    if (vUrl) media.push({ type: "video", url: vUrl, thumbnail_url: thumb });
  }
  // fallback pra outros actors (imagens no root)
  const legacyImages = raw.images ?? raw.imageUrls;
  if (Array.isArray(legacyImages) && media.length === 0) {
    for (const item of legacyImages) {
      if (typeof item === "string") media.push({ type: "photo", url: item });
    }
  }
  const legacyVideoUrl = pickString(raw, ["videoUrl", "video_url"]);
  if (legacyVideoUrl && media.length === 0) {
    media.push({ type: "video", url: legacyVideoUrl });
  }

  // ---- Engagement ----
  const statsObj = (raw.stats ?? {}) as Record<string, unknown>;
  const reactions =
    pickNumber(statsObj, [
      "total_reactions",
      "totalReactions",
      "reactionsCount",
      "reactions",
      "likes",
    ]) ??
    pickNumber(raw, [
      "totalReactions",
      "reactionsCount",
      "reactions",
      "numLikes",
      "likes",
      "likesCount",
    ]);
  const comments =
    pickNumber(statsObj, ["comments", "commentsCount", "numComments"]) ??
    pickNumber(raw, [
      "numComments",
      "commentsCount",
      "comments",
      "commentCount",
    ]);
  const reshares =
    pickNumber(statsObj, ["reposts", "shares", "reshares"]) ??
    pickNumber(raw, [
      "numShares",
      "sharesCount",
      "shares",
      "reshares",
      "repostsCount",
    ]);

  // ---- Post type ----
  const rawPostType = pickString(raw, ["post_type", "postType"])?.toLowerCase();
  let postType: NonNullable<RawPost["post_type"]> = "unknown";
  if (raw.article) postType = "article";
  else if (raw.job_data) postType = "job";
  else if (rawPostType === "regular") postType = "regular";
  else if (rawPostType === "repost") postType = "repost";
  else if (rawPostType === "quote") postType = "quote";

  return {
    channel: CHANNEL,
    post_ref,
    raw_ref: pickString(urnObj, ["activity_urn", "ugcPost_urn"]),
    author_handle: authorHandle,
    author_display_name: authorDisplay,
    author_avatar_url: authorAvatarUrl,
    author_headline: authorHeadline,
    text,
    lang: pickString(raw, ["language", "lang"]),
    created_at: created,
    url: postUrl,
    media,
    engagement: {
      reactions: reactions as MaybePrimitive as number | undefined,
      comments: comments as MaybePrimitive as number | undefined,
      reshares: reshares as MaybePrimitive as number | undefined,
    },
    post_type: postType,
    fetched_via_profile: fetchedViaProfile,
    raw_meta: raw,
  };
}

/** apimaestro devolve "2026-07-09 19:22:39" (space separator, sem TZ). Assume UTC. */
function parseApimaestroDate(date: string | undefined): string | undefined {
  if (!date) return undefined;
  if (date.includes("T")) return date;
  const iso = date.replace(" ", "T") + "Z";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
}

function tsToIso(ts: number | undefined): string | undefined {
  if (!ts || !Number.isFinite(ts)) return undefined;
  // apimaestro pode devolver ms ou s — normaliza
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
}

function safeDecodeUri(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function extractHandleFromUrl(url: string | undefined): string {
  if (!url) return "";
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? m[1] : "";
}

// ---- Input schema por actor ----
//
// APIFY nao padroniza input entre actors. Cada um usa nomes diferentes.
// Se trocar de actor, adicionar case aqui. Fallback usa nomes mais comuns.

/**
 * V5.0.3: apimaestro aceita `username` como STRING singular (nao array).
 * Uma chamada = uma bridge. Adapter faz Promise.all pra paralelizar.
 *
 * Se algum actor futuro aceitar batch, retorna input com array e o adapter
 * detecta via `isBatchInput()` abaixo — evita loop desnecessario.
 */
function buildActorInput(
  actorId: string,
  singleProfileUrl: string,
  postsPerProfile: number
): Record<string, unknown> {
  const handle = extractHandleFromUrl(singleProfileUrl);

  switch (actorId) {
    case "apimaestro/linkedin-profile-posts":
      return {
        username: handle,
        limit: postsPerProfile,
      };
    case "harvestapi/linkedin-profile-posts":
      return {
        profileUrls: [singleProfileUrl],
        maxPosts: postsPerProfile,
      };
    case "dev_fusion/Linkedin-Profile-Scraper":
      return {
        profileUrls: [singleProfileUrl],
        proxy: { useApifyProxy: true },
      };
    default:
      return {
        profileUrl: singleProfileUrl,
        username: handle,
        limit: postsPerProfile,
      };
  }
}

// ---- Adapter ----

export interface LinkedInAdapterConfig {
  workspace_id: string;
  bundle_id?: string;
  actor_id?: string;
  posts_per_profile?: number;
  /** V5.3: token APIFY do profile (opcional). Passa pro edge function que
   *  usa em vez do secret server-side quando presente. */
  apify_token?: string;
}

export const linkedinAdapter: ChannelAdapter = {
  channel: CHANNEL,
  charLimit: LIMITS.LINKEDIN_COMMENT_CHAR_LIMIT,

  async fetchPosts(
    cfg: unknown,
    options: FetchOptions
  ): Promise<FetchResult> {
    const config = cfg as LinkedInAdapterConfig;
    if (!config?.workspace_id) {
      throw new Error("linkedinAdapter.fetchPosts: workspace_id obrigatorio");
    }

    // resolve bundle
    let bundleId = config.bundle_id;
    if (!bundleId) {
      const bundle = await getActiveBundle(config.workspace_id, CHANNEL);
      if (!bundle) {
        throw new Error(
          "Nenhum bundle Groundswell ativo pra este workspace. Suba um em Settings ou use o bundle default do time."
        );
      }
      bundleId = bundle.id;
    }

    // V5.3.2: normaliza input em targets {url, postsLimit}.
    // Prioridade: bridgeTargets (tier custom) > bridgeIdentifiers (default) >
    // fetch getActiveBridges (default).
    const defaultLimit =
      config.posts_per_profile ?? APIFY.DEFAULT_POSTS_PER_PROFILE;

    let targets: BridgeFetchTarget[];
    if (options.bridgeTargets && options.bridgeTargets.length > 0) {
      targets = options.bridgeTargets;
    } else if (options.bridgeIdentifiers && options.bridgeIdentifiers.length > 0) {
      targets = options.bridgeIdentifiers.map((url) => ({
        url,
        postsLimit: defaultLimit,
      }));
    } else {
      const bridgeRows = await getActiveBridges(bundleId);
      targets = bridgeRows
        .map(
          (b): BridgeFetchTarget | null => {
            const url =
              b.linkedin_url ??
              (b.public_identifier
                ? `https://www.linkedin.com/in/${b.public_identifier}`
                : undefined);
            return url ? { url, postsLimit: defaultLimit } : null;
          }
        )
        .filter((t): t is BridgeFetchTarget => t !== null);
    }

    // V5.3.2: filtra bridges com URL invalida ANTES do APIFY.
    // extractHandleFromUrl retorna "" pra URLs que nao batem `/in/handle`
    // (ex: /company/foo, /pub/legacy-id, empty string, garbage). Se mandar
    // `{username: ""}` pro APIFY, ele responde 400 Bad Request e trava o
    // batch todo. Melhor filtrar aqui e logar as rejeitadas.
    const validTargets: BridgeFetchTarget[] = [];
    const invalidTargets: string[] = [];
    for (const t of targets) {
      if (extractHandleFromUrl(t.url)) validTargets.push(t);
      else invalidTargets.push(t.url);
    }
    if (invalidTargets.length > 0) {
      console.warn(
        `[linkedin] ${invalidTargets.length} URL(s) invalidas ignoradas:`,
        invalidTargets.slice(0, 5)
      );
    }
    if (validTargets.length === 0) {
      return {
        posts: [],
        cached: false,
        cost: { cu: 0, usd: 0 },
        fetchedAt: Date.now(),
      };
    }
    // Cap pra proteger custo — mesmo se bundle tiver muitas bridges
    const capped = validTargets.slice(0, APIFY.MAX_PROFILES_PER_RUN);

    const actorId = config.actor_id ?? DEFAULT_ACTOR;

    // V5.0.3: apimaestro aceita 1 username por chamada. Paraleliza N chamadas.
    // Cache-key por-bridge — refresh subsequente com maioria em cache e barato.
    // Falhas parciais nao invalidam o run inteiro (algumas bridges podem
    // ter perfil privado, rate-limited, etc).
    // V5.1: batches de 3 com 1s delay entre eles — APIFY rate-limits 6+
    // paralelo com 429. 3 x N batches respeita ~10 req/sec por actor.
    const bypassCache = options.cache === "bypass";
    const BATCH_SIZE = 3;
    const BATCH_DELAY_MS = 1000;
    const results: PromiseSettledResult<{ profileUrl: string } & Awaited<
      ReturnType<typeof apifyFetch>
    >>[] = [];
    for (let i = 0; i < capped.length; i += BATCH_SIZE) {
      const batch = capped.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map((target) =>
          apifyFetch({
            workspace_id: config.workspace_id,
            actor_id: actorId,
            input: buildActorInput(actorId, target.url, target.postsLimit),
            cache_ttl_ms: APIFY.CACHE_TTL_MS,
            bypass_cache: bypassCache,
            apify_token: config.apify_token,
          }).then((r) => ({ profileUrl: target.url, ...r }))
        )
      );
      results.push(...batchResults);
      // Delay so entre batches (nao apos o ultimo)
      if (i + BATCH_SIZE < capped.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    const posts: RawPost[] = [];
    let totalCu = 0;
    let totalUsd = 0;
    let cachedCount = 0;
    const failures: string[] = [];

    for (const settled of results) {
      if (settled.status === "rejected") {
        failures.push((settled.reason as Error)?.message ?? "unknown");
        continue;
      }
      const r = settled.value;
      totalCu += r.cost?.cu ?? 0;
      totalUsd +=
        actorId === APIFY.LINKEDIN_POSTS_ACTOR && !r.cached
          ? r.items.length * APIFY.LINKEDIN_POST_USD
          : r.cost?.usd ?? 0;
      if (r.cached) cachedCount++;
      const beforeCount = posts.length;
      for (const raw of r.items as Array<Record<string, unknown>>) {
        const normalized = normalizeLinkedInPost(raw, r.profileUrl);
        if (normalized) posts.push(normalized);
      }
      // V5.1 debug: por-bridge, mostra count + timestamps mais recente/antigo
      // pra diagnosticar quando janela grande retorna 0.
      const bridgePosts = posts.slice(beforeCount);
      if (bridgePosts.length > 0) {
        const times = bridgePosts
          .map((p) => (p.created_at ? Date.parse(p.created_at) : NaN))
          .filter(Number.isFinite);
        const newest = times.length ? new Date(Math.max(...times)).toISOString() : "?";
        const oldest = times.length ? new Date(Math.min(...times)).toISOString() : "?";
        console.log(
          `[linkedin] bridge ${r.profileUrl.split("/in/")[1] ?? r.profileUrl}: ` +
            `${bridgePosts.length} post(s), newest=${newest}, oldest=${oldest}, cached=${r.cached}`
        );
      } else {
        console.log(
          `[linkedin] bridge ${r.profileUrl.split("/in/")[1] ?? r.profileUrl}: 0 posts (cached=${r.cached})`
        );
      }
    }

    if (failures.length > 0) {
      console.warn(
        `[linkedin] ${failures.length}/${capped.length} bridges falharam:`,
        failures.slice(0, 3)
      );
    }
    console.log(
      `[linkedin] apify total: ${capped.length} bridges, ${cachedCount} cache hits, ` +
        `${posts.length} posts, $${totalUsd.toFixed(3)}`
    );

    // V5.3.2: auto-recover de cache negativo antigo.
    //
    // Bug historico: se APIFY um dia devolveu [] pra uma bridge (ratelimit,
    // hiccup, etc), o edge function velho gravava items=[] no apify_cache
    // com TTL 24h/72h. Refresh subsequente batia no cache e servia [] sem
    // re-consultar APIFY. Bridge ficava "morta" por dias.
    //
    // Fix client-side: se recebemos posts=0 mas alguma bridge deu cache hit,
    // tenta AUTOMATICAMENTE 1x com bypass_cache=true (custa 1 chamada extra
    // por bridge, mas garante que cache negativo nao trave). So retry se:
    //   - Nao estamos ja em bypass (evita loop)
    //   - Ao menos 1 cache hit (indica cache negativo, nao ratelimit fresco)
    //   - Nenhum post veio (nao tem o que rescatar)
    const shouldAutoRetry =
      !bypassCache && cachedCount > 0 && posts.length === 0;
    if (shouldAutoRetry) {
      console.warn(
        `[linkedin] auto-retry: 0 posts + ${cachedCount} cache hit(s) — cache negativo detectado, refazendo com bypass`
      );
      const retryResults: PromiseSettledResult<{ profileUrl: string } & Awaited<
        ReturnType<typeof apifyFetch>
      >>[] = [];
      for (let i = 0; i < capped.length; i += BATCH_SIZE) {
        const batch = capped.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batch.map((target) =>
            apifyFetch({
              workspace_id: config.workspace_id,
              actor_id: actorId,
              input: buildActorInput(actorId, target.url, target.postsLimit),
              cache_ttl_ms: APIFY.CACHE_TTL_MS,
              bypass_cache: true,
              apify_token: config.apify_token,
            }).then((r) => ({ profileUrl: target.url, ...r }))
          )
        );
        retryResults.push(...batchResults);
        if (i + BATCH_SIZE < capped.length) {
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }
      const retryPosts: RawPost[] = [];
      let retryUsd = 0;
      let retryCu = 0;
      for (const settled of retryResults) {
        if (settled.status !== "fulfilled") continue;
        const r = settled.value;
        retryCu += r.cost?.cu ?? 0;
        retryUsd +=
          actorId === APIFY.LINKEDIN_POSTS_ACTOR && !r.cached
            ? r.items.length * APIFY.LINKEDIN_POST_USD
            : r.cost?.usd ?? 0;
        for (const raw of r.items as Array<Record<string, unknown>>) {
          const normalized = normalizeLinkedInPost(raw, r.profileUrl);
          if (normalized) retryPosts.push(normalized);
        }
      }
      console.log(
        `[linkedin] auto-retry recolheu ${retryPosts.length} posts, +$${retryUsd.toFixed(3)}`
      );
      // Retorna resultado do retry (posts sao verdade, custo e dos dois runs)
      return {
        posts: retryPosts,
        cached: false,
        cost: {
          cu: totalCu + retryCu,
          usd: totalUsd + retryUsd,
          provider: "apify",
        },
        fetchedAt: Date.now(),
      };
    }

    return {
      posts,
      cached: cachedCount === capped.length,
      cost: {
        cu: totalCu,
        usd: totalUsd,
        provider: "apify",
      },
      fetchedAt: Date.now(),
    };
  },

  buildReplyIntent(post: RawPost, replyText: string) {
    // LinkedIn nao tem intent URL publica. Estrategia:
    //  1. Copia reply pro clipboard (feito pelo caller)
    //  2. Retorna URL do post pra abrir em nova aba
    //  3. Analista cola manualmente no comentario
    void replyText;
    return {
      kind: "clipboard_and_open" as const,
      url: post.url,
      needsClipboard: true,
    };
  },
};
