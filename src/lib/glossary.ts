// V6 — Glossario dos termos tecnicos usados no Replai (Groundswell + LLM +
// analytics). Consumido por:
//   - <InfoPopover term="X" /> chip inline em componentes
//   - <GlossaryView /> tela dedicada com busca + entries expandiveis
//
// Convencao dos textos:
//   short: 1-2 linhas, cabe no popover flutuante sem scroll
//   long:  1-3 paragrafos com detalhes, exemplos, precedencia
//   related: outros termos do glossario ligados (chips clicaveis na view)
//
// Nao inclua termos triviais tipo "workspace", "voz". Aqui e vocabulario
// especifico que analistas NOVOS nao entendem sem contexto.

export interface GlossaryEntry {
  short: string;
  long: string;
  related?: string[];
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  POI: {
    short:
      "Person of Interest — pessoa que voce quer que note voce. E o alvo final do reply, nao quem voce esta respondendo.",
    long: [
      "POIs (Persons of Interest) sao contas identificadas pelo Groundswell como alvos estrategicos. Voce nao responde diretamente pra elas — voce responde em posts das Bridges (contas proximas do POI) pra ser NOTADO.",
      "O racional: se o POI ja engaja com a Bridge (like/comment), replies suas no post da Bridge caem no feed/notificacoes do POI. E um vetor indireto de exposicao.",
      "Cada POI tem um ISV (Influence Surplus Value) e outras metricas de rede — voce ve rankings dele nas listas do Groundswell.",
    ].join("\n\n"),
    related: ["Bridge", "ISV", "relation_type"],
  },
  Bridge: {
    short:
      "Ponte (Bridge) — pessoa proxima do POI. Replies em posts dela expoem seu conteudo indiretamente pro POI.",
    long: [
      "Bridges sao contas identificadas pelo Groundswell com forte engagement com POIs. Sao seu alvo pratico do dia-a-dia: voce responde nos posts DELAS, nao dos POIs.",
      "Cada Bridge tem scores Groundswell: readiness_score (quao pronta pra receber replies), profile_fit_score (quao alinhada com sua voz), context_fit (in_context = tema alinhado com POI, out_of_context = tema irrelevante).",
      "Bridges com readiness_tier=ready sao as mais quentes. As de tier=emerging valem menos e as de needs_work sao geralmente puladas.",
    ].join("\n\n"),
    related: ["POI", "readiness_tier", "context_fit", "relation_type"],
  },
  ISV: {
    short:
      "Influence Surplus Value — score de rede (0-100) que estima poder de influencia por conta.",
    long: [
      "ISV combina metricas de rede (pagerank, hits_authority, degree) num score 0-100 comparavel entre perfis. Perfis com ISV alto tem alcance amplificado — reply que engaja com um ISV=95 tende a repercutir mais que um ISV=40.",
      "Tiers:",
      "- mega (>=90): milhoes de followers, raramente respondem",
      "- large (70-89): pode responder se voce provocar curiosidade",
      "- mid (40-69): sweet-spot pra engajamento real",
      "- small (<40 ou fora do grafo): menos provavel notar",
    ].join("\n\n"),
    related: ["POI"],
  },
  readiness_tier: {
    short:
      "Escala Groundswell de quao 'pronta' uma Bridge esta pra receber replies: ready > emerging > needs_work.",
    long: [
      "readiness_tier categoriza as Bridges em 3 baldes:",
      "- **ready**: alto engajamento historico com POIs relevantes, contexto alinhado, voz da Bridge compativel — replies aqui sao mais provavelmente notados.",
      "- **emerging**: sinais parciais. Vale tentar mas ROI menor.",
      "- **needs_work**: sinais fracos. Skip por default.",
      "",
      "O tier e calculado a partir de readiness_score (numeric) que combina profile_fit, context_fit, voice_quality e proximity.",
    ].join("\n\n"),
    related: ["Bridge"],
  },
  context_fit: {
    short:
      "in_context = Bridge fala de temas relevantes pro POI. out_of_context = fora do tema.",
    long: [
      "context_fit indica se o post/perfil da Bridge esta alinhado com o tema que os POIs se importam. in_context = alta chance de replies gerarem trafego pro POI-target. out_of_context = engagement com a Bridge nao vai chegar no POI relevante.",
      "Groundswell computa isso ao analisar o topic distribution da Bridge e comparar com os POIs mapeados no bundle.",
    ].join("\n\n"),
    related: ["Bridge"],
  },
  relation_type: {
    short:
      "Como o POI e a Bridge interagem: inner_circle, sporadic_contact, one_way_admiration, etc.",
    long: [
      "relation_type classifica o vinculo POI ↔ Bridge:",
      "- **inner_circle**: interacao bidirecional recorrente — POI comenta/reage aos posts da Bridge com frequencia. Melhor vetor de exposicao.",
      "- **sporadic_contact**: interacao ocasional — vale mas menos garantido.",
      "- **one_way_admiration**: POI segue/reage mas Bridge nao reciproca — ainda gera visibilidade se POI ver o post.",
      "- outros tipos variam por bundle Groundswell.",
    ].join("\n\n"),
    related: ["POI", "Bridge"],
  },
  Persona: {
    short:
      "Voz define TOM. Publicos-alvo definem QUEM voce quer que note as replies.",
    long: [
      "Persona no Replai eh a soma de Voz + Publicos-alvo:",
      "- **Voz**: como voce escreve (tom, jargao, referencias). Injetada como PRIMARIA no prompt do LLM.",
      "- **Publicos-alvo (persona_public_target)**: descricoes livres dos publicos que voce quer notar suas replies. O LLM ancora dado / perspectiva que essas audiencias valorizariam ver — sem mencionar as audiencias explicitamente.",
      "",
      "Exemplos de publico-alvo: `VCs cripto de Sao Paulo`, `founders de fintech seed`, `engenheiros web3 seniores`.",
      "",
      "Cross-canal: injetado tanto no prompt do X quanto no prompt do LinkedIn.",
    ].join("\n\n"),
  },
  Groundswell: {
    short:
      "Estrategia de impactar POIs indiretamente via replies em posts das Bridges.",
    long: [
      "Groundswell e o metodo que o time Moic usa pra construir presenca com POIs sem interpelar eles diretamente. Em vez de tentar chamar atencao do POI com replies nos posts DELE, voce constroi visibilidade replicando VALOR nos posts das Bridges dele.",
      "Cada bundle Groundswell traz: profiles (POIs + Bridges), relationships (POI ↔ Bridge), interactions (historico), source_profiles (topic + intention distribution). Voce carrega o bundle em Settings > canal (X ou LinkedIn) e o Replai passa a filtrar posts das Bridges + calcular POI-targets sugeridos por post.",
    ].join("\n\n"),
    related: ["POI", "Bridge"],
  },
  Watchtower: {
    short:
      "Rotina de sugestao de POSTS (nao replies) baseada em conteudo diario da Moic.",
    long: [
      "Watchtower e a rotina paralela ao pipeline de replies. Puxa contexto diario (Notion + posts virais recentes) e gera SUGESTOES de posts que voce pode publicar naquele dia. Usa a mesma voz do workspace + o mesmo LLM.",
      "Nao confunde com triagem: triagem e reply em post DE OUTRO. Watchtower e proposta de post SEU.",
    ].join("\n\n"),
  },
};

export function getGlossaryTerms(): string[] {
  return Object.keys(GLOSSARY);
}
