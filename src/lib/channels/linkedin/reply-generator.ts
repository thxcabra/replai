// V5 — Reply generator LinkedIn com contexto Groundswell.
//
// Nao usa o buildSystemPrompt do canal X (aquele tem categorias 9-way X-specific
// que nao fazem sentido no LinkedIn). Constroi prompt novo com:
//   1. Voice LinkedIn do workspace (obrigatoria)
//   2. Contexto do Bridge (rationale Groundswell, topics de engajamento)
//   3. Contexto do POI-target (relation_type, reciprocity, ISV)
//   4. Objetivo estrategico (impactar POI via reply em post da Bridge)
//   5. Instrucao de tom LinkedIn (formal, longform, sem tell de bot)

import { LIMITS, LINKEDIN_COMPLIANCE } from "../../constants";
import { getPoiProfile, getSourceProfile } from "../../groundswell/storage";
import { trackLLMCall } from "../../reply-core/cost-tracker";
import { callLLM } from "../../reply-core/llm-caller";
import type {
  GroundswellBridge,
  GroundswellProfile,
  GroundswellSourceProfile,
  PoiCandidate,
  RawPost,
} from "../types";
import type { Config, SkillPayload, SkillReply } from "../../types";

export interface LinkedInReplyRequest {
  post: RawPost;
  bridge: GroundswellBridge;
  /** V5.2: nullable. Se null (lista manual), reply e "direto ao autor da
   * bridge" sem POI-target indireto — usa prompt buildLinkedInDirectSystemPrompt. */
  poi: PoiCandidate | null;
  bundleId: string;
  workspace: {
    linkedinVoice: string;
  };
  /** V6: workspace id pra track analytics + cost_usd cross-canal */
  workspaceId?: string;
  config: Config;
  /** Categorias ja usadas em replies anteriores desta bridge (evita repeticao) */
  keep_categories?: string[];
}

export interface LinkedInReplyResult {
  replies: SkillReply[];
  strategy_note: string;
  llm_provider: string;
  llm_model: string;
  llm_input_tokens: number | null;
  llm_output_tokens: number | null;
  llm_cost_usd: number | null;
  ms: number;
}

export async function generateLinkedInReply(
  req: LinkedInReplyRequest
): Promise<LinkedInReplyResult> {
  const start = Date.now();
  const { post, bridge, poi, bundleId, workspace, config, keep_categories } = req;

  if (!workspace.linkedinVoice || workspace.linkedinVoice.trim().length < 50) {
    throw new Error(
      "Voice LinkedIn nao configurada. Voice e obrigatoria pra este canal."
    );
  }

  // Enriquecimentos opcionais — nao bloqueiam se falhar
  const sourceProfile = await getSourceProfile(bundleId, bridge.bridge_id).catch(
    () => null
  );
  const poiProfile = poi
    ? await getPoiProfile(bundleId, poi.poi_id).catch(() => null)
    : null;

  // V5.2: dois prompts distintos. Groundswell (com POI) mantem estrategia
  // indireta. Manual/direto (sem POI) foca em "comentario de valor" pro autor.
  const systemPrompt = poi
    ? buildLinkedInSystemPrompt(
        workspace.linkedinVoice,
        bridge,
        poi,
        sourceProfile,
        poiProfile,
        config.linkedin_persona_public_target?.length
          ? config.linkedin_persona_public_target
          : config.persona_public_target
      )
    : buildLinkedInDirectSystemPrompt(
        workspace.linkedinVoice,
        bridge,
        sourceProfile,
        config.linkedin_persona_public_target?.length
          ? config.linkedin_persona_public_target
          : config.persona_public_target
      );

  const strategyNote = poi
    ? buildStrategyNote(bridge, poi, poiProfile)
    : `Reply direto na conexao ${bridge.name} — lista manual (sem pessoa-alvo)`;

  const payload: SkillPayload = {
    tweets: [
      {
        tweet_id: post.post_ref,
        handle: post.author_handle,
        text: post.text,
        lang: post.lang ?? "en",
        // context nao aplica direto — LinkedIn nao tem thread parent no mesmo
        // formato do X. Deixamos null.
        context: null,
      },
    ],
    // V5: hint pro LLM que estamos regenerando categorias evitadas
    ...(keep_categories && keep_categories.length > 0
      ? { keep_categories }
      : {}),
  } as unknown as SkillPayload;

  const result = await callLLM(payload, config, systemPrompt);
  const ms = Date.now() - start;
  const model =
    config.llm_provider === "anthropic" ? config.model : "gemini-2.5-flash";

  // V6: cost_usd real (antes hardcoded null) via helper cross-canal.
  // sessionId null: LinkedIn ainda nao usa session_logs; track/estimateCost
  // rodam mesmo assim. workspaceId opcional pra tolerar callers antigos.
  const { cost_usd } = await trackLLMCall({
    sessionId: null,
    workspaceId: req.workspaceId ?? "",
    channel: "linkedin",
    provider: config.llm_provider,
    model,
    ms,
    usage: result.usage,
    itemsIn: 1,
    resultsOut: result.output.results.length,
    hasVoice: workspace.linkedinVoice.trim().length > 0,
    source: "linkedin_reply",
  });

  return {
    replies: result.output.results[0]?.replies ?? [],
    strategy_note: strategyNote,
    llm_provider: config.llm_provider,
    llm_model: model,
    llm_input_tokens: result.usage.input_tokens,
    llm_output_tokens: result.usage.output_tokens,
    llm_cost_usd: cost_usd,
    ms,
  };
}

// ============================================================================
// System prompt builder LinkedIn (nao usa buildSystemPrompt do X)
// ============================================================================

function buildLinkedInSystemPrompt(
  voice: string,
  bridge: GroundswellBridge,
  poi: PoiCandidate,
  sourceProfile: GroundswellSourceProfile | null,
  poiProfile: GroundswellProfile | null,
  personaPublicTarget?: string[] | null
): string {
  const sections: string[] = [];

  // Voice primeiro — abre o frame
  sections.push(
    "## Voz do analista (PRIMARIA)",
    "",
    "Voce e o profissional descrito abaixo. Esta voz define quem voce e, do que voce fala, como voce escreve. As regras abaixo (contexto Groundswell + estrategia) sao restricoes operacionais — o TOM vem desta voz.",
    "",
    voice.trim(),
    "",
    "---",
    ""
  );

  // V6: Publicos-alvo (Persona). Extra layer sobre a voz — quem deve NOTAR.
  const publics = (personaPublicTarget ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (publics.length > 0) {
    sections.push(
      "## Publicos-alvo (Persona)",
      "",
      "Ao ancorar dado ou perspectiva, prefira angulos que os publicos abaixo — nao a Bridge — valorizariam ver. Nao mencione essas audiencias explicitamente.",
      "",
      ...publics.map((p) => `- ${p}`),
      "",
      "---",
      ""
    );
  }

  // Objetivo estrategico Groundswell — o coracao do V5
  sections.push(
    "## Objetivo estrategico (Groundswell)",
    "",
    "Voce NAO esta respondendo apenas ao autor deste post. Voce esta respondendo pra ser NOTADO pelo POI-target listado abaixo. A logica: POI segue/interage com a Bridge, entao replies em posts da Bridge caem no feed/notificacoes do POI. Sua reply e um vetor indireto de exposicao.",
    "",
    "Regras estrategicas:",
    "1. **Nao mencione o POI diretamente** — soa forcado, quebra o efeito indireto.",
    "2. **Ancore em tema que a Bridge engaja** — abaixo listamos topic distributions dela.",
    "3. **Adicione valor ao thread** — nao seja concordancia vazia. Se possivel, adicione dado, caso, ou perspectiva que o POI (dado o perfil dele abaixo) valorizaria ver.",
    "4. **Formato LinkedIn** — tom formal, expositivo, longform ok. NAO usar 'imho', 'tbh', gírias X. Podem ser 3-5 linhas.",
    "",
    "---",
    ""
  );

  // Bridge context
  sections.push("## Bridge (autor do post que voce esta respondendo)", "");
  sections.push(`**Nome**: ${bridge.name}`);
  if (bridge.headline) sections.push(`**Headline**: ${bridge.headline}`);
  if (bridge.current_company) sections.push(`**Empresa**: ${bridge.current_company}`);
  if (bridge.readiness_tier)
    sections.push(`**Readiness Groundswell**: ${bridge.readiness_tier} (score ${bridge.readiness_score?.toFixed(1) ?? "n/a"})`);
  if (bridge.rationale)
    sections.push(`**Por que essa bridge**: ${bridge.rationale}`);
  if (sourceProfile?.engaged_topic_distribution) {
    const topics = topTopics(sourceProfile.engaged_topic_distribution, 5);
    if (topics.length > 0)
      sections.push(`**Topics que ela engaja**: ${topics.join(", ")}`);
  }
  if (sourceProfile?.intention_distribution) {
    const intentions = topTopics(sourceProfile.intention_distribution, 3);
    if (intentions.length > 0)
      sections.push(`**Intencoes dominantes**: ${intentions.join(", ")}`);
  }
  sections.push("");

  // POI target context
  sections.push("## POI-target (indireto — nao mencione)", "");
  sections.push(`**Nome**: ${poi.poi_name}`);
  if (poiProfile?.headline) sections.push(`**Headline**: ${poiProfile.headline}`);
  if (poiProfile?.current_company)
    sections.push(`**Empresa**: ${poiProfile.current_company}`);
  sections.push(`**Relacao Bridge → POI**: ${poi.relation_type.replace(/_/g, " ")}`);
  sections.push(`**Interacoes historicas**: ${poi.n_interactions}`);
  if (poi.reciprocity)
    sections.push(`**Reciprocidade**: SIM — o POI ja engajou de volta com esta bridge`);
  sections.push("");

  // Anti-patterns (menos verbose que canal X — LinkedIn tem menos tell)
  sections.push(
    "## Anti-padroes",
    "",
    "- Nunca mencione o POI-target pelo nome",
    "- Nunca elogio puro ou concordancia vazia",
    "- Nunca 'obrigado por compartilhar', 'otimo post', 'muito interessante'",
    "- Nao invente dado, empresa, ou paper pra encaixar",
    "- Nao use categorias X (perguntar sobre thread, cross-pollination, etc)",
    `- Max ${LIMITS.LINKEDIN_COMMENT_CHAR_LIMIT} chars por reply`,
    "",
    "---",
    ""
  );

  // Output format
  sections.push(
    "## Formato do output",
    "",
    "Retorne JSON conforme o schema padrao. Gere 1-2 replies com **categorias diferentes** entre si. Categorias validas neste canal:",
    "- `dado_concreto` (traz numero, estudo, benchmark)",
    "- `experiencia_builder` (fala de projeto/produto que voce construiu)",
    "- `caso_concreto` (traz exemplo de empresa/setor)",
    "- `nomear_fenomeno` (batiza um padrao que a Bridge descreveu)",
    "- `perspectiva_contraria` (discorda civil, com fundamento)",
    "",
    "Para cada reply, pense se ela e algo que o POI-target descrito acima leria e considerariaengajando de volta com a Bridge (like/comment/DM). Se a resposta for nao, tente outra."
  );

  return sections.join("\n");
}

function topTopics(
  dist: Record<string, number>,
  n: number
): string[] {
  return Object.entries(dist)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([k]) => k);
}

// V5.2: label PT-BR pra readiness_tier na strategy_note gravada em linkedin_replies.
// V5.3.2: exporter novo introduziu `promising` e `not_yet` — labels novos.
function readinessLabel(tier?: string | null): string {
  if (tier === "ready") return "pronto";
  if (tier === "emerging" || tier === "promising") return "emergindo";
  if (tier === "needs_work" || tier === "not_yet") return "em construcao";
  return tier ?? "?";
}

function buildStrategyNote(
  bridge: GroundswellBridge,
  poi: PoiCandidate,
  _poiProfile: GroundswellProfile | null
): string {
  const parts: string[] = [];
  parts.push(
    `Reply na conexao ${bridge.name}${
      bridge.readiness_tier ? ` (${readinessLabel(bridge.readiness_tier)})` : ""
    }`
  );
  parts.push(
    `→ visibilidade indireta pra pessoa-alvo ${poi.poi_name} via ${poi.relation_type.replace(/_/g, " ")}`
  );
  if (poi.reciprocity)
    parts.push("(pessoa-alvo ja engajou de volta com essa conexao)");
  return parts.join(" ");
}

// V5.2 — Prompt "direto ao autor" pra listas MANUAIS (sem POI-target Groundswell).
// Diferencas vs buildLinkedInSystemPrompt:
//   - Nao ha secao "POI-target (indireto — nao mencione)"
//   - Objetivo estrategico simplificado: comentario de valor no proprio post
//   - Bridge context ainda usado (nome/headline/rationale) pra ancorar
//   - Anti-padroes + format identicos (max 500 chars, tom formal LinkedIn)
function buildLinkedInDirectSystemPrompt(
  voice: string,
  bridge: GroundswellBridge,
  sourceProfile: GroundswellSourceProfile | null,
  personaPublicTarget?: string[] | null
): string {
  const sections: string[] = [];

  sections.push(
    "## Voz do analista (PRIMARIA)",
    "",
    "Voce e o profissional descrito abaixo. Esta voz define quem voce e, do que voce fala, como voce escreve. As regras abaixo sao restricoes operacionais — o TOM vem desta voz.",
    "",
    voice.trim(),
    "",
    "---",
    ""
  );

  const publics = (personaPublicTarget ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (publics.length > 0) {
    sections.push(
      "## Publicos-alvo (Persona)",
      "",
      "Ao ancorar dado ou perspectiva, prefira angulos que os publicos abaixo valorizariam ver. Nao mencione essas audiencias explicitamente.",
      "",
      ...publics.map((p) => `- ${p}`),
      "",
      "---",
      ""
    );
  }

  sections.push(
    "## Objetivo (reply direto)",
    "",
    "Voce esta comentando no post do autor abaixo. Objetivo: **comentario de valor** que o proprio autor + audiencia dele valorizariam ver. Sem POI-target indireto — quem voce quer engajar e o autor + rede dele.",
    "",
    "Regras:",
    "1. **Ancore em algo especifico do post** — nome citado, dado mencionado, argumento central. Generico = ignorado.",
    "2. **Adicione valor** — dado concreto, caso, perspectiva contraria fundamentada, pergunta que puxa continuacao.",
    "3. **Nunca elogio puro** ou 'obrigado por compartilhar' — tell de bot.",
    "4. **Formato LinkedIn** — tom formal, 2-4 linhas idealmente. Sem gírias X ('imho', 'tbh').",
    "",
    "---",
    ""
  );

  sections.push("## Autor do post (bridge)", "");
  sections.push(`**Nome**: ${bridge.name}`);
  if (bridge.headline) sections.push(`**Headline**: ${bridge.headline}`);
  if (bridge.current_company)
    sections.push(`**Empresa**: ${bridge.current_company}`);
  if (bridge.rationale)
    sections.push(`**Por que essa pessoa esta na lista**: ${bridge.rationale}`);
  if (sourceProfile?.engaged_topic_distribution) {
    const topics = topTopics(sourceProfile.engaged_topic_distribution, 5);
    if (topics.length > 0)
      sections.push(`**Topics que ela engaja**: ${topics.join(", ")}`);
  }
  sections.push("");

  sections.push(
    "## Anti-padroes",
    "",
    "- Nunca elogio puro ou concordancia vazia",
    "- Nunca 'obrigado por compartilhar', 'otimo post', 'muito interessante'",
    "- Nao invente dado, empresa, ou paper pra encaixar",
    "- Nao use categorias X (perguntar sobre thread, cross-pollination, etc)",
    `- Max ${LIMITS.LINKEDIN_COMMENT_CHAR_LIMIT} chars por reply`,
    "",
    "---",
    ""
  );

  sections.push(
    "## Formato do output",
    "",
    "Retorne JSON conforme o schema padrao. Gere 1-2 replies com categorias diferentes. Categorias validas:",
    "- `dado_concreto` (traz numero, estudo, benchmark)",
    "- `experiencia_builder` (fala de projeto/produto que voce construiu)",
    "- `caso_concreto` (traz exemplo de empresa/setor)",
    "- `nomear_fenomeno` (batiza um padrao que a Bridge descreveu)",
    "- `perspectiva_contraria` (discorda civil, com fundamento)"
  );

  return sections.join("\n");
}

// Reexport pra permitir constants leves em outros lugares
export { LINKEDIN_COMPLIANCE };
