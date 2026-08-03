// V5.2 — Sugestao de posts LinkedIn (independente do X posts-suggestion).
//
// Pipeline:
//   1. Fetch ate ~12 replies LinkedIn postadas do workspace (linkedin_replies)
//   2. Extrai POIs top do bundle Groundswell ativo (contexto de audiencia)
//   3. Manda pro Gemini Flash com prompt LinkedIn-first (formal, longform)
//   4. Retorna 5-10 sugestoes {angle, hook, body, why, category}
//
// Custo: ~$0.001-0.002 por refresh (sem imagem — LinkedIn nao usa image gen).

import { GEMINI_API_KEY } from "../../keys";
import { supabase } from "../../supabase";
import { getSession } from "../../auth";
import { getActiveBundle } from "../../groundswell/storage";
import type { Workspace } from "../../types";

const ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

export interface LinkedInPostSuggestion {
  angle: string;
  hook: string;
  body: string;
  why: string;
  category: string;
}

export interface LinkedInPostsResult {
  suggestions: LinkedInPostSuggestion[];
  recentReplies: Array<{
    post_content: string;
    reply_text: string;
    reply_category: string | null;
    post_author_name: string | null;
  }>;
  poiSample: string[];  // nomes dos POIs top do bundle (contexto)
  ms: number;
  errors: string[];
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

function buildSystemPrompt(voice: string, personaTargets: string[]): string {
  const personaLine = personaTargets.length
    ? `\n== PUBLICOS-ALVO (personas) ==\n${personaTargets.map((p) => `- ${p}`).join("\n")}\n`
    : "";
  return `Voce e um curator estrategico de conteudo pro LinkedIn. Dada (a) a voz
LinkedIn da persona, (b) publicos-alvo que ela quer notar seus posts, (c) o
texto completo das ultimas replies LinkedIn dela (com contexto do post
original), e (d) uma amostra de POIs do bundle Groundswell ativo (perfis que
ela mira), voce vai sugerir 5-10 IDEIAS DE POSTS ORIGINAIS pra ela publicar
hoje no LinkedIn.

Cada sugestao tem 5 campos:
- angle: tema/dominio (ex: "fintech-b2b-risco", "product-strategy-fase-2")
- hook: primeira frase pra puxar atencao (max 120 chars, longform-friendly)
- body: corpo do post sugerido (LinkedIn: 3-5 linhas, ate 700 chars)
- why: por que ESSE post agora — sinal das replies recentes (1 frase)
- category: opiniao | analise | contraponto | historia | dado | pergunta

CRITERIOS:
1. Sintetize 1-2 TESES EMERGENTES nas replies recentes (tema recorrente,
   angulo argumentativo) e amplifique cada uma num post que sirva de "capa"
   pro que ela tem defendido em replies.
2. Adapte tom pros publicos-alvo listados — cada sugestao deve tocar em
   sinal que essas audiencias valorizariam ver (dado, contraponto, historia).
3. LinkedIn premia LONGFORM (3-5 linhas). Nao escreva short-form estilo X.
4. Sem hashtags. Sem emoji ostensivo. Sem saudacao formal.
5. Sem paralelismo formal ("Nao X, mas Y"). Sem tell de bot.
6. Tom calibrado pela voz da persona — nada generico. Evite jargao corporativo.
${personaLine}
== VOZ LINKEDIN DA PERSONA ==

${voice}`;
}

interface Payload {
  recent_replies: Array<{
    post_content: string;
    post_author?: string | null;
    reply_text: string;
    category?: string | null;
  }>;
  poi_sample: string[];
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string };
}

export async function suggestLinkedInPosts(
  workspace: Workspace
): Promise<LinkedInPostsResult> {
  const startedAt = Date.now();
  const errors: string[] = [];
  const { config } = workspace;

  const voice = (config.linkedin_voice ?? "").trim();
  if (!voice) {
    errors.push(
      "Sem voz LinkedIn configurada — sugestoes ficariam genericas. Configure em Settings > LinkedIn."
    );
    return {
      suggestions: [],
      recentReplies: [],
      poiSample: [],
      ms: Date.now() - startedAt,
      errors,
    };
  }

  const apiKey = config.gemini_api_key?.trim() || GEMINI_API_KEY;
  if (!apiKey) {
    errors.push("Sem chave Gemini configurada.");
    return {
      suggestions: [],
      recentReplies: [],
      poiSample: [],
      ms: Date.now() - startedAt,
      errors,
    };
  }

  // 1. Replies LinkedIn recentes (postadas + com texto)
  const recentReplies = await fetchRecentLinkedInReplies(workspace.id);

  // 2. POIs top do bundle ativo (contexto de audiencia)
  const poiSample = await fetchPoiSample(workspace.id);

  // V5.2 fix: persona LinkedIn foi removida da UI (redundante). Cai no
  // fallback pra persona_public_target (X) — mesma pessoa, mesma audiencia.
  const liTargets = (config as { linkedin_persona_public_target?: string[] })
    .linkedin_persona_public_target;
  const personaTargets: string[] = liTargets?.length
    ? liTargets
    : (config.persona_public_target ?? []);

  const payload: Payload = {
    recent_replies: recentReplies.map((r) => ({
      post_content: r.post_content.slice(0, 500),
      post_author: r.post_author_name,
      reply_text: r.reply_text.slice(0, 500),
      category: r.reply_category,
    })),
    poi_sample: poiSample,
  };

  const body = {
    system_instruction: {
      parts: [{ text: buildSystemPrompt(voice, personaTargets) }],
    },
    contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.85,
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
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
      recentReplies,
      poiSample,
      ms: Date.now() - startedAt,
      errors,
    };
  }
  if (!res.ok) {
    errors.push(`Gemini HTTP ${res.status}`);
    return {
      suggestions: [],
      recentReplies,
      poiSample,
      ms: Date.now() - startedAt,
      errors,
    };
  }

  let suggestions: LinkedInPostSuggestion[] = [];
  try {
    const data = (await res.json()) as GeminiResponse;
    const txt = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = JSON.parse(txt) as { suggestions?: LinkedInPostSuggestion[] };
    suggestions = parsed.suggestions ?? [];
  } catch (e) {
    errors.push(`Parse falhou: ${(e as Error).message}`);
  }

  return {
    suggestions,
    recentReplies,
    poiSample,
    ms: Date.now() - startedAt,
    errors,
  };
}

async function fetchRecentLinkedInReplies(
  workspaceId: string
): Promise<Array<{
  post_content: string;
  reply_text: string;
  reply_category: string | null;
  post_author_name: string | null;
}>> {
  const session = await getSession();
  if (!session?.user?.id) return [];
  try {
    const { data, error } = await supabase
      .from("linkedin_replies")
      .select("post_content, reply_text, reply_category, post_author_name")
      .eq("workspace_id", workspaceId)
      .eq("decision", "posted")
      .not("reply_text", "is", null)
      .order("logged_at", { ascending: false })
      .limit(12);
    if (error) {
      console.warn("[linkedin/posts-suggestion] query falhou:", error);
      return [];
    }
    return (data ?? [])
      .filter((r) => (r as { reply_text: string | null }).reply_text)
      .map((r) => ({
        post_content: (r as { post_content: string | null }).post_content ?? "",
        reply_text: (r as { reply_text: string }).reply_text,
        reply_category: (r as { reply_category: string | null }).reply_category ?? null,
        post_author_name: (r as { post_author_name: string | null }).post_author_name ?? null,
      }));
  } catch (e) {
    console.warn("[linkedin/posts-suggestion] exception:", e);
    return [];
  }
}

async function fetchPoiSample(workspaceId: string): Promise<string[]> {
  try {
    const bundle = await getActiveBundle(workspaceId, "linkedin");
    if (!bundle) return [];
    // Top POIs por pagerank_adjusted (metrica de autoridade). Fallback pra
    // ordem inserida quando nao ha score (bundles manuais).
    const { data, error } = await supabase
      .from("groundswell_profiles")
      .select("name, pagerank_adjusted")
      .eq("bundle_id", bundle.id)
      .eq("is_poi", true)
      .not("name", "is", null)
      .order("pagerank_adjusted", { ascending: false, nullsFirst: false })
      .limit(20);
    if (error) return [];
    return (data ?? [])
      .map((r) => (r as { name: string | null }).name ?? "")
      .filter(Boolean);
  } catch {
    return [];
  }
}
