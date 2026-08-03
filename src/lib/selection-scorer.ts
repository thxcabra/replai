import { friendlyHttpMessage } from "./errors";
import { GEMINI_API_KEY } from "./keys";
import type { Config, EnrichedTweet } from "./types";

// V4.1 — 2.9 Selection scorer dual.
// Pos prefilter mecanico, ranqueia tweets por (persona_relevance +
// engagement_potential) com Gemini Flash batch (1 chamada). Score combinado
// usado pra UI top-N + sort. Custo ~$0.001 por refresh.
//
// Quando NAO roda:
//   - sem chave Gemini configurada
//   - workspace sem voz (filtro precisa de voz pra ranquear relevancia)
//   - dryRun = true
//   - selectionFilter.enabled = false
// Em todos esses casos, retorna scores null pra cada tweet (UI mostra
// todos sem ordenacao por score).

const ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

export interface TweetScore {
  tweet_id: string;
  persona_relevance: number;     // 0-100
  engagement_potential: number;  // 0-100
  combined: number;              // 0-100
  reason: string;
}

export interface ScorerResult {
  scores: Map<string, TweetScore>;
  enabled: boolean;
  ms: number;
  hidden_count: number;
  avg_relevance: number | null;
  avg_engagement: number | null;
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    scores: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          tweet_id: { type: "STRING" },
          persona_relevance: { type: "INTEGER" },
          engagement_potential: { type: "INTEGER" },
          reason: { type: "STRING" },
        },
        required: ["tweet_id", "persona_relevance", "engagement_potential", "reason"],
        propertyOrdering: [
          "tweet_id",
          "persona_relevance",
          "engagement_potential",
          "reason",
        ],
      },
    },
  },
  required: ["scores"],
};

function buildScorerSystemPrompt(voice: string): string {
  return `Voce e um curador estrategico de tweets. Dado o perfil ABAIXO da persona
analista e uma lista de tweets candidatos, voce vai pontuar cada tweet em DOIS
eixos independentes:

1. PERSONA RELEVANCE (0-100): o quanto o tema do tweet alinha com o dominio,
   referencias e interesses da persona. 100 = tema central da persona. 50 =
   adjacente. 0 = totalmente fora.

2. ENGAGEMENT POTENTIAL (0-100): o quao provavel esse AUTOR ESPECIFICO
   notar/responder/engajar de volta se receber uma reply de valor. Calibracao:
   - autor MEGA (ISV >90, milhoes followers): raramente responde. 0-30 a menos
     que tenha sinal forte (autor faz pergunta, tweet pequeno).
   - autor LARGE (ISV 70-90): pode engajar se reply provoca curiosidade. 40-70.
   - autor MID (ISV 40-70): tier sweet-spot pra engajamento. 60-90.
   - autor SMALL (ISV <40 ou fora_grafo): variavel. Se conteudo curto +
     pergunta = 50-70; se thread densa autoral = 30-40.
   Multiplicadores:
   - autor com first_contact (nunca interagimos) = mantem tier
   - autor com engagement_back_rate > 0.4 = +15 (historico bate)
   - autor cooldown_recommended = true (respondemos 3+ sem retorno) = -30
   - tweet em hot_topic do batch = +5

== PERSONA ==

${voice}

== INSTRUCOES DE OUTPUT ==

Retorne JSON estrito (sem markdown) com array "scores". Cada item:
- tweet_id: id do tweet
- persona_relevance: int 0-100
- engagement_potential: int 0-100
- reason: 1 frase muito curta (max 80 chars) explicando o score

Seja honesto. Tweets fora do dominio devem receber relevance baixa. Tweets de
autores mega + tema generico devem receber engagement baixo. Nao seja
generoso por padrao.`;
}

interface ScorerTweetPayload {
  tweet_id: string;
  text: string;
  lang: string;
  author: {
    handle: string;
    isv: number;
    inferred_layer: number;
    is_poi: boolean;
    followers?: number;
    not_in_graph: boolean;
  };
  signals?: {
    topics?: string[];
    claim_type?: string;
    is_part_of_hot_topic?: boolean;
    engagement_back_rate?: number;
    cooldown_recommended?: boolean;
    is_first_contact?: boolean;
    successful_categories?: string[];
  };
}

function buildScorerPayload(tweets: EnrichedTweet[]): ScorerTweetPayload[] {
  return tweets.map((t) => {
    const intel = t.intelligence;
    return {
      tweet_id: t.tweet_id,
      text: t.text,
      lang: t.lang,
      author: {
        handle: t.handle,
        isv: t.isv,
        inferred_layer: t.inferred_layer,
        is_poi: t.is_poi === 1,
        followers: t.raw_meta?.author?.followers,
        not_in_graph: Boolean(t.not_in_graph),
      },
      signals: intel
        ? {
            topics: intel.analysis.topics,
            claim_type: intel.analysis.claim_type,
            is_part_of_hot_topic: intel.batch_signals?.is_part_of_hot_topic,
            engagement_back_rate: intel.author_profile?.engagement_back_rate,
            cooldown_recommended: intel.author_profile?.cooldown_recommended,
            is_first_contact: intel.author_profile?.is_first_contact,
            successful_categories: intel.author_profile?.successful_categories,
          }
        : undefined,
    };
  });
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  error?: { message?: string };
}

interface ScorerOutput {
  scores: Array<{
    tweet_id: string;
    persona_relevance: number;
    engagement_potential: number;
    reason: string;
  }>;
}

export async function scoreTweets(
  tweets: EnrichedTweet[],
  config: Config
): Promise<ScorerResult> {
  const startedAt = Date.now();
  const empty: ScorerResult = {
    scores: new Map(),
    enabled: false,
    ms: 0,
    hidden_count: 0,
    avg_relevance: null,
    avg_engagement: null,
  };

  // Filtro desabilitado explicitamente ou sem voz → pula
  if (config.selectionFilter?.enabled === false) return empty;
  const voice = config.voice?.trim() ?? "";
  if (!voice) return empty;
  if (tweets.length === 0) return empty;

  const apiKey = config.gemini_api_key?.trim() || GEMINI_API_KEY;
  if (!apiKey) return empty;

  const payload = { tweets: buildScorerPayload(tweets) };
  const body = {
    system_instruction: { parts: [{ text: buildScorerSystemPrompt(voice) }] },
    contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.3,         // baixa pra scoring consistente
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch {
    console.warn("[scorer] network failure, scorer skipped");
    return empty;
  }

  if (!response.ok) {
    console.warn(
      "[scorer] HTTP",
      response.status,
      friendlyHttpMessage("gemini", response.status)
    );
    // Erro do scorer NAO bloqueia o refresh — vai todos os tweets sem score
    return empty;
  }

  let data: GeminiResponse;
  try {
    data = await response.json();
  } catch {
    return empty;
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) return empty;

  let parsed: ScorerOutput;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.warn("[scorer] JSON parse falhou:", text.slice(0, 200));
    return empty;
  }

  const engagementWeight = config.selectionFilter?.engagementWeight ?? 0.6;
  const scores = new Map<string, TweetScore>();
  let totalR = 0;
  let totalE = 0;
  let count = 0;
  for (const raw of parsed.scores ?? []) {
    const r = clampScore(raw.persona_relevance);
    const e = clampScore(raw.engagement_potential);
    const combined = Math.round(e * engagementWeight + r * (1 - engagementWeight));
    scores.set(raw.tweet_id, {
      tweet_id: raw.tweet_id,
      persona_relevance: r,
      engagement_potential: e,
      combined,
      reason: String(raw.reason ?? "").slice(0, 140),
    });
    totalR += r;
    totalE += e;
    count += 1;
  }

  return {
    scores,
    enabled: true,
    ms: Date.now() - startedAt,
    hidden_count: 0,  // calculado pelo caller apos aplicar topN
    avg_relevance: count > 0 ? Math.round(totalR / count) : null,
    avg_engagement: count > 0 ? Math.round(totalE / count) : null,
  };
}

function clampScore(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// Aplica scores em-place ao array de tweets + aplica topN + threshold.
// Retorna { visible, hidden }: visible = vai pra UI (top-N ordenado),
// hidden = pode ser expandido pelo banner "+N ocultos".
export function applyScores(
  tweets: EnrichedTweet[],
  result: ScorerResult,
  config: Config
): { visible: EnrichedTweet[]; hidden: EnrichedTweet[] } {
  // Anexa scores ao tweet (mutacao OK — orchestrator constroi tweets novos)
  for (const t of tweets) {
    const s = result.scores.get(t.tweet_id);
    if (s) {
      t.persona_relevance = s.persona_relevance;
      t.engagement_potential = s.engagement_potential;
      t.selection_combined = s.combined;
      t.selection_reason = s.reason;
    } else {
      t.persona_relevance = null;
      t.engagement_potential = null;
      t.selection_combined = null;
      t.selection_reason = null;
    }
  }

  // Sem filtro ativo OU sem scores → tudo visivel, nada hidden
  if (!result.enabled || result.scores.size === 0) {
    return { visible: tweets, hidden: [] };
  }

  // Ordena por combined desc, com tweets sem score caindo pro final
  const sorted = [...tweets].sort((a, b) => {
    const av = a.selection_combined ?? -1;
    const bv = b.selection_combined ?? -1;
    return bv - av;
  });

  const topN = config.selectionFilter?.topN ?? 15;
  const threshold = config.selectionFilter?.threshold;

  let visible: EnrichedTweet[];
  let hidden: EnrichedTweet[];
  if (threshold !== undefined) {
    visible = sorted.filter((t) => (t.selection_combined ?? 0) >= threshold);
    hidden = sorted.filter((t) => (t.selection_combined ?? 0) < threshold);
  } else {
    visible = sorted.slice(0, topN);
    hidden = sorted.slice(topN);
  }
  return { visible, hidden };
}
