import { GEMINI_API_KEY } from "./keys";
import { generatePostImage, type GeneratedImage } from "./gemini-image";
import { supabase } from "./supabase";
import { getSession } from "./auth";
import { TIMEOUTS } from "./constants";
import { fetchTodayWatchtower, type WatchtowerDigest } from "./notion";
import { fetchListTweets, viralScore } from "./twitterapi";
import type { Workspace } from "./types";

// V4.1.1 — Posts suggestion engine.
//
// Pipeline:
//   1. fetch Watchtower de hoje (Notion)
//   2. fetch viral posts da Lista (TwitterAPI) — top-N por viralScore
//   3. fetch ultimas 50 replies postadas do analista (Supabase reply_logs)
//   4. monta prompt cross-referenciando os 3 + voz do workspace
//   5. chama Gemini Flash → retorna 5-10 sugestoes de posts originais
//
// Custo: ~$0.002 por refresh (Notion gratis, TwitterAPI ~5 cents, Gemini ~$0.002).

const SUGGEST_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

export interface PostSuggestion {
  angle: string;         // "macro-fed", "ai-tooling", "contraste com mercado"
  hook: string;          // primeira frase pra puxar atencao
  body: string;          // corpo do post (sugerido, ate 280 chars)
  why: string;           // por que ESSE post agora (sinal do batch)
  category: string;      // "opiniao", "dado", "pergunta", "contraponto"
  // V4.1.6: imagem gerada via Gemini image (no lugar do Unsplash, evita
  // host_permission novo + termos de uso). Prompt direciona pra estilo
  // editorial/foto, NAO arte de IA tipica.
  image?: GeneratedImage | null;
  // V4.1.6: topico usado pra gerar a imagem (debug)
  image_topic?: string;
}

// V5.2: modos de sugestao de posts.
//   watchtower — so Watchtower + viral posts (comportamento V4.1.x)
//   replies_synthesis — so replies recentes com texto completo (novo)
//   hybrid — mescla os dois (default)
export type PostsSuggestionMode = "watchtower" | "replies_synthesis" | "hybrid";

export interface PostsSuggestionResult {
  suggestions: PostSuggestion[];
  watchtower?: WatchtowerDigest | null;
  viralPosts: Array<{
    handle: string;
    text: string;
    url?: string;
    likes: number;
    retweets: number;
    replies: number;
  }>;
  recentReplyCategories: string[];   // categorias mais usadas pela persona
  // V5.2: replies recentes com contexto (usadas em replies_synthesis + hybrid)
  recentReplies?: Array<{
    tweet_text: string;
    reply_text: string;
    reply_category: string | null;
  }>;
  mode: PostsSuggestionMode;
  ms: number;
  errors: string[];   // erros nao-fatais coletados (Notion sem token, etc)
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    suggestions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          angle: { type: "STRING" },
          hook: { type: "STRING" },
          body: { type: "STRING" },
          why: { type: "STRING" },
          category: { type: "STRING" },
        },
        required: ["angle", "hook", "body", "why", "category"],
        propertyOrdering: ["angle", "hook", "body", "why", "category"],
      },
    },
  },
  required: ["suggestions"],
};

function buildSystemPrompt(voice: string, mode: PostsSuggestionMode): string {
  const modeSection = (() => {
    if (mode === "watchtower") {
      return `MODO: watchtower — foco em cobrir os temas do dia com angulo
proprio da persona. Priorize Watchtower e viral posts da Lista X. Use
categorias recentes so pra evitar saturar. NAO sintetize replies passadas.`;
    }
    if (mode === "replies_synthesis") {
      return `MODO: replies_synthesis — foco na SINTESE das ultimas replies.
Detecte 1-2 TESES EMERGENTES nas replies recentes (tema recorrente, angulo
argumentativo, adversario retornante) e amplifique cada tese num post
editorial que sirva de "capa" pro que ela tem defendido pontualmente.
Watchtower e viral posts sao secundarios — use so pra ancorar em atualidade
quando fizer sentido. Nunca fuja das teses.`;
    }
    return `MODO: hybrid — mescle Watchtower (temas do dia) + sintese das
ultimas replies (teses emergentes). Cada sugestao deve indicar no "why" se
veio de Watchtower, de replies recentes ou da interseccao dos dois.`;
  })();

  return `Voce e um curator estrategico de conteudo. Dada (a) a voz/persona do
analista abaixo, (b) o Watchtower do dia (briefing curado de noticias e
tendencias), (c) viral posts da Lista do X que ele monitora, (d) categorias
de replies que ele tem postado recentemente, e (e) o texto completo das
ultimas replies postadas (com contexto do tweet original), voce vai sugerir
5-10 ideias de POSTS ORIGINAIS pra ele publicar hoje.

${modeSection}

Cada sugestao tem 5 campos:
- angle: tema/dominio (ex: "macro-fed", "ai-tooling", "contraste-x-y")
- hook: primeira frase pra puxar atencao (max 100 chars)
- body: corpo do post sugerido (ate 280 chars, formatado como ja postavel no X)
- why: por que ESSE post agora — sinal do batch (e origem: watchtower/replies/hybrid)
- category: opiniao | dado | pergunta | contraponto | analise | observacao

CRITERIOS GERAIS:
1. Cobre TEMAS do Watchtower com angulo proprio da persona (nao apenas reportar).
2. Reage a algum viral post citado, mas com adicao genuina (nao concordancia vazia).
3. Quando watchtower.viralText estiver disponivel, ele contem virais CURADOS
   pelo time — usa esses como referencia primaria de tema/tom de mercado
   (sao sinais mais fortes que os virais da Lista X bruta).
4. Evita repetir categorias que a persona ja saturou recentemente (diversifica).
5. Tom calibrado pela voz da persona — nada generico.
6. Sem travessao, sem tells de LLM, sem paralelismo formal.

== VOZ DA PERSONA ==

${voice}`;
}

interface SuggestionPayload {
  watchtower?: {
    title: string;
    text: string;
    // V4.1.8: conteudo da subpagina "Viral Posts" do Watchtower (opcional)
    viralText?: string;
  };
  viral_posts: Array<{
    handle: string;
    text: string;
    likes: number;
    retweets: number;
    replies: number;
  }>;
  recent_reply_categories: { category: string; count: number }[];
  // V5.2: replies com contexto pro modo replies_synthesis / hybrid.
  recent_replies_with_context?: Array<{
    tweet_text: string;
    reply_text: string;
    category: string | null;
  }>;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string };
}

// Limites pra controlar custo + payload
const VIRAL_TOP_N = 15;
const RECENT_REPLIES_LIMIT = 50;
const WATCHTOWER_MAX_CHARS = 8000;

export async function suggestPosts(
  workspace: Workspace,
  options?: { watchtowerDate?: string; mode?: PostsSuggestionMode }
): Promise<PostsSuggestionResult> {
  const startedAt = Date.now();
  const errors: string[] = [];
  const { config } = workspace;
  const mode: PostsSuggestionMode = options?.mode ?? "hybrid";
  const needsReplies = mode === "replies_synthesis" || mode === "hybrid";

  // V4.1.7: Watchtower via Edge Function proxy.
  // V4.1.8: aceita date especifico (YYYY-MM-DD) pra pegar Watchtower antigo.
  // V4.1.14 (CR-02): pageId nao mais passado do client — fixed no Supabase secret.
  let watchtower: WatchtowerDigest | null = null;
  try {
    watchtower = await fetchTodayWatchtower(undefined, options?.watchtowerDate);
  } catch (e) {
    errors.push(`Notion: ${(e as Error).message}`);
  }

  // 2. Viral posts da Lista
  const viralPostsFormatted: PostsSuggestionResult["viralPosts"] = [];
  try {
    const twitterKey =
      config.twitterapi_key?.trim() ||
      (await import("./keys")).TWITTERAPI_KEY;
    const listId =
      (config.lists && config.activeListId
        ? config.lists.find((l) => l.id === config.activeListId)?.listId
        : null) ?? config.listId;
    if (twitterKey && listId) {
      const sinceMs = Date.now() - 24 * 60 * 60 * 1000;  // ultimas 24h
      const rawTweets = await fetchListTweets(
        listId,
        twitterKey,
        sinceMs,
        4   // 4 paginas e suficiente pra encontrar virals
      );
      const sorted = [...rawTweets]
        .filter((t) => t.text && t.text.length > 20)
        .sort((a, b) => viralScore(b) - viralScore(a))
        .slice(0, VIRAL_TOP_N);
      for (const t of sorted) {
        viralPostsFormatted.push({
          handle: t.author?.userName ?? "(unknown)",
          text: t.text ?? "",
          url: t.url,
          likes: t.engagement?.likeCount ?? 0,
          retweets: t.engagement?.retweetCount ?? 0,
          replies: t.engagement?.replyCount ?? 0,
        });
      }
    }
  } catch (e) {
    errors.push(`Viral posts: ${(e as Error).message}`);
  }

  // 3. Categorias recentes do analista (reply_logs)
  const recentCategories = await fetchRecentReplyCategories(workspace.id);
  // V5.2: replies com texto — so quando o modo pede sintese.
  const recentRepliesWithContext = needsReplies
    ? await fetchRecentRepliesWithContext(workspace.id)
    : [];

  // 4. Monta payload pro LLM + chama Gemini Flash
  const apiKey = config.gemini_api_key?.trim() || GEMINI_API_KEY;
  if (!apiKey) {
    errors.push("Sem chave Gemini — sugestoes nao geradas.");
    return {
      suggestions: [],
      watchtower,
      viralPosts: viralPostsFormatted,
      recentReplyCategories: recentCategories.map((c) => c.category),
      recentReplies: recentRepliesWithContext,
      mode,
      ms: Date.now() - startedAt,
      errors,
    };
  }
  const voice = config.voice?.trim() ?? "";
  if (!voice) {
    errors.push(
      "Sem voz configurada — sugestoes ficariam genericas. Configure em Settings."
    );
    return {
      suggestions: [],
      watchtower,
      viralPosts: viralPostsFormatted,
      recentReplyCategories: recentCategories.map((c) => c.category),
      recentReplies: recentRepliesWithContext,
      mode,
      ms: Date.now() - startedAt,
      errors,
    };
  }

  const payload: SuggestionPayload = {
    watchtower: watchtower
      ? {
          title: watchtower.title,
          text: watchtower.text.slice(0, WATCHTOWER_MAX_CHARS),
          viralText: watchtower.viralText?.slice(0, WATCHTOWER_MAX_CHARS),
        }
      : undefined,
    viral_posts: viralPostsFormatted.map((v) => ({
      handle: v.handle,
      text: v.text,
      likes: v.likes,
      retweets: v.retweets,
      replies: v.replies,
    })),
    recent_reply_categories: recentCategories,
    recent_replies_with_context: recentRepliesWithContext.length
      ? recentRepliesWithContext.map((r) => ({
          tweet_text: r.tweet_text.slice(0, 400),
          reply_text: r.reply_text.slice(0, 400),
          category: r.reply_category,
        }))
      : undefined,
  };

  const body = {
    system_instruction: { parts: [{ text: buildSystemPrompt(voice, mode) }] },
    contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.9,
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  let res: Response;
  try {
    res = await fetch(SUGGEST_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch {
    errors.push("Falha de rede ao chamar Gemini.");
    return {
      suggestions: [],
      watchtower,
      viralPosts: viralPostsFormatted,
      recentReplyCategories: recentCategories.map((c) => c.category),
      recentReplies: recentRepliesWithContext,
      mode,
      ms: Date.now() - startedAt,
      errors,
    };
  }
  if (!res.ok) {
    errors.push(`Gemini HTTP ${res.status}`);
    return {
      suggestions: [],
      watchtower,
      viralPosts: viralPostsFormatted,
      recentReplyCategories: recentCategories.map((c) => c.category),
      recentReplies: recentRepliesWithContext,
      mode,
      ms: Date.now() - startedAt,
      errors,
    };
  }

  let suggestions: PostSuggestion[] = [];
  try {
    const data = (await res.json()) as GeminiResponse;
    const txt = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = JSON.parse(txt) as { suggestions?: PostSuggestion[] };
    suggestions = parsed.suggestions ?? [];
  } catch (e) {
    errors.push(`Parse falhou: ${(e as Error).message}`);
  }

  // V4.1.6: gera imagem via Gemini pra cada sugestao (paralelo, best-effort).
  // V4.1.14 (WR-05): timeout por imagem evita que 1 modelo lento bloqueie
  // a tela de Posts inteira (antes worst case era ~900s, agora 30s/img).
  suggestions = await Promise.all(
    suggestions.map(async (s) => {
      const imageTopic = buildImageTopic(s);
      if (!imageTopic) return s;
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        TIMEOUTS.IMAGE_GEN_MS
      );
      try {
        const image = await generatePostImage(imageTopic, {
          signal: controller.signal,
        });
        return { ...s, image, image_topic: imageTopic };
      } catch {
        return s;
      } finally {
        clearTimeout(timer);
      }
    })
  );

  return {
    suggestions,
    watchtower,
    viralPosts: viralPostsFormatted,
    recentReplyCategories: recentCategories.map((c) => c.category),
    recentReplies: recentRepliesWithContext,
    mode,
    ms: Date.now() - startedAt,
    errors,
  };
}

// V5.2: fetch das ultimas replies postadas com texto completo (nao so
// categorias). Usado no modo replies_synthesis / hybrid pra sintetizar
// teses emergentes.
async function fetchRecentRepliesWithContext(
  workspaceId: string
): Promise<Array<{ tweet_text: string; reply_text: string; reply_category: string | null }>> {
  const session = await getSession();
  if (!session?.user?.id) return [];
  try {
    const { data, error } = await supabase
      .from("reply_logs")
      .select("tweet_text, reply_text, reply_category")
      .eq("user_id", session.user.id)
      .eq("workspace_id", workspaceId)
      .eq("decision", "posted")
      .not("reply_text", "is", null)
      .order("logged_at", { ascending: false })
      .limit(12);
    if (error) {
      console.warn("[posts-suggestion] recent replies query falhou:", error);
      return [];
    }
    return (data ?? [])
      .filter((r) => (r as { reply_text: string | null }).reply_text)
      .map((r) => ({
        tweet_text: (r as { tweet_text: string | null }).tweet_text ?? "",
        reply_text: (r as { reply_text: string }).reply_text,
        reply_category: (r as { reply_category: string | null }).reply_category ?? null,
      }));
  } catch (e) {
    console.warn("[posts-suggestion] recent replies exception:", e);
    return [];
  }
}

// V4.1.6: topic pra gerar imagem via Gemini. Mais descritivo que query
// keyword-based (Imagen funciona melhor com frases completas).
function buildImageTopic(s: PostSuggestion): string {
  const angle = s.angle.replace(/-/g, " ").trim();
  const hook = (s.hook ?? "").trim().slice(0, 100);
  return hook ? `${hook} (theme: ${angle})` : angle;
}

// Helper: top-N categorias usadas em replies postadas pela persona nos
// ultimos N dias. Usado pra evitar sugestoes que duplicam o que ela ja saturou.
async function fetchRecentReplyCategories(
  workspaceId: string
): Promise<{ category: string; count: number }[]> {
  const session = await getSession();
  if (!session?.user?.id) return [];
  try {
    const { data, error } = await supabase
      .from("reply_logs")
      .select("reply_category")
      .eq("user_id", session.user.id)
      .eq("workspace_id", workspaceId)
      .not("reply_category", "is", null)
      .order("logged_at", { ascending: false })
      .limit(RECENT_REPLIES_LIMIT);
    if (error) {
      console.warn("[posts-suggestion] reply_logs query falhou:", error);
      return [];
    }
    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const c = (row as { reply_category?: string }).reply_category;
      if (!c) continue;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  } catch (e) {
    console.warn("[posts-suggestion] fetchRecentReplyCategories:", e);
    return [];
  }
}

// Tambem usado em config-handling: aceita URL completa do Notion ou page ID
// puro e retorna apenas o ID normalizado.
export function normalizeWatchtowerInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const m = trimmed.match(/([a-f0-9]{32})/i);
  if (m) return m[1].toLowerCase();
  const m2 = trimmed.match(/([a-f0-9-]{36})/i);
  if (m2) return m2[1].replace(/-/g, "").toLowerCase();
  return trimmed.toLowerCase();
}
