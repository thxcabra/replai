import skillRaw from "../assets/SKILL.md?raw";
import { buildBasePrompt, type PromptSection } from "./reply-core/prompt-builder";

// Remove o frontmatter YAML (bloco entre os dois primeiros '---') do SKILL.md.
// O corpo restante e usado como system prompt base da skill replai.
function stripFrontmatter(md: string): string {
  const match = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (match) {
    return md.slice(match[0].length).trim();
  }
  return md.trim();
}

// SKILL.md = parte generica do prompt (anti-tropes, regras de idioma, categorias
// de valor). Tudo que NAO muda por workspace.
export const SKILL_REPLAI_SYSTEM_PROMPT = stripFrontmatter(skillRaw as string);

// V6: dispatcher de prompt X. Cache LRU e concatenacao vivem em
// reply-core/prompt-builder.ts (compartilhado com LinkedIn). Este arquivo
// ainda mantem os TEXTOS especificos do canal (Objetivo estrategico de
// engajamento por tier, skill base, lembrete final) — sao regras de negocio
// do X, nao caem em builder generico.
//
// Precedencia (V4.1): voz PRIMARIA no topo, base como referencia tecnica,
// lembrete no fim. Voz no topo abre o frame de personalidade. Skill no meio
// funciona como referencia tecnica. Lembrete no fim garante compliance.
export function buildSystemPrompt(
  voice: string | null | undefined,
  basePrompt?: string | null | undefined,
  personaPublicTarget?: string[] | null
): string {
  const voiceTrimmed = (voice ?? "").trim();
  const baseTrimmed = (basePrompt ?? "").trim();
  const baseToUse = baseTrimmed || SKILL_REPLAI_SYSTEM_PROMPT;
  const publics = (personaPublicTarget ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  const publicsKey = publics.join("|");
  const cacheKey = `x|${voiceTrimmed}|||${baseToUse}|||p:${publicsKey}`;

  const sections: PromptSection[] = [];

  if (voiceTrimmed) {
    sections.push({
      title: "Voz / personalidade do workspace (PRIMARIA)",
      body: [
        "Voce e o profissional descrito abaixo. Esta voz define quem voce e, do que voce fala, como voce escreve, e quais referencias voce traz. As regras tecnicas mais abaixo (skill base) sao restricoes operacionais — mas o TOM e o ANGULO vem desta voz aqui.",
        "",
        voiceTrimmed,
      ].join("\n"),
    });
  }

  if (publics.length > 0) {
    sections.push({
      title: "Publicos-alvo (Persona)",
      body: [
        "Suas replies sao NOTADAS por audiencias especificas. Ao ancorar dado ou perspectiva, prefira angulos que os publicos abaixo — nao o autor do tweet — valorizariam ver. Isso NAO significa mencionar essas audiencias; significa escolher o que dizer com elas em mente.",
        "",
        ...publics.map((p) => `- ${p}`),
      ].join("\n"),
    });
  }

  // V4.1 — 2.10: Objetivo estrategico de engajamento. Vem ANTES do skill
  // base, pra estabelecer que o objetivo nao e so reply boa mas engajamento
  // bidirecional. Aplicado SOMENTE quando o payload incluir author_context
  // (caso contrario, prompt explicativo seria ruido).
  sections.push({
    title: "Objetivo estrategico de engajamento",
    body: [
      "Voce nao esta escrevendo apenas replies 'boas'. Voce esta criando replies pensadas pra serem NOTADAS pelo autor de cada tweet e abrir possibilidade de engajamento bidirecional (resposta, quote, follow, conversa).",
      "",
      "Quando o payload de um tweet incluir `author_context`, calibre o TOM e o FORMATO da reply pelo tier do autor:",
      "",
      "- **mega** (ISV >=90, milhoes de followers): autor raramente responde. Foco em valor publico que outros leitores citem ou QT'em — engajar via terceiros. EVITE servilismo, EVITE pergunta direta (sera ignorada). Use afirmacao com ancoragem em dado especifico do tweet dele.",
      "- **large** (ISV 70-89): pode responder se a reply provocar curiosidade. Ancore em dado concreto ou contraste especifico do conteudo dele. Evite generico.",
      "- **mid** (ISV 40-69): tier sweet-spot pra engajamento real. Pode usar pergunta genuina, oferecer extensao do raciocinio dele, ou trazer caso concreto que ele desconheca. Tom proximo, nao subordinado.",
      "- **small** (ISV <40 ou fora_grafo): menos provavel notar. Reply vale se conteudo dele indica disposicao a conversa. Tom direto.",
      "",
      "Quando `author_context.cooldown_recommended = true`, voce ja respondeu 3+ vezes esse autor sem retorno. Considere PULAR ou faze-la realmente excepcional — provavelmente nao engajara.",
      "",
      "Quando `author_context.is_first_contact = true`, primeira interacao. Apresenta valor concreto sem trazer historico de relacionamento ('como falamos antes' = falso).",
      "",
      "Quando `author_context.successful_categories` listar categorias, da preferencia a elas pra UMA das replies (autor historicamente engaja com esse formato).",
      "",
      "Regras gerais (todos os tiers):",
      "1. ANCORE em algo especifico do tweet — nome citado, dado mencionado, pergunta implicita. Generico = ignorado.",
      "2. CRIE GANCHO de continuacao — afirmacao que provoca discordancia civil, pergunta que so o autor pode responder, dado que adiciona ao argumento dele em vez de competir.",
      "3. NUNCA elogio puro ou concordancia vazia (tells de bot).",
      "4. RESPEITE diversidade de categorias entre as N replies do tweet.",
    ].join("\n"),
  });

  sections.push({
    title: "Skill base — restricoes tecnicas e categorias de valor",
    body: [
      "As regras abaixo definem ANTI-PADROES (o que NAO fazer) e categorias de valor disponiveis. Aplique a sua voz dentro deste sandbox tecnico. Nao deixe as regras puxarem o tom pra generico — elas existem so pra evitar tells de LLM e garantir diversidade entre as 2-3 replies.",
      "",
      baseToUse,
    ].join("\n"),
  });

  sections.push({
    title: "Lembrete final (precedência absoluta sobre voz e skill)",
    body: [
      '- **Idioma da reply vem do campo `lang` de cada tweet** (`en` → inglês, `pt` → português, `""` → detecte pelo texto). O idioma em que esta voz ou skill estao escritos e IRRELEVANTE. Tweet com `lang: "en"` recebe reply em ingles, mesmo que voz/skill estejam em portugues.',
      "- Sem travessão (`—`), sem tells de LLM, sem paralelismo negativo. Vale sempre.",
      "- Diversidade de categoria entre as 2-3 replies do mesmo tweet.",
      "- Honestidade: nunca invente número, paper, ou nome de empresa pra encaixar na voz. Se não tem certeza, troca pra `pergunta_especialista` ou `nomear_fenomeno`.",
      "- Quando o payload incluir `attachments`, leia as URLs como contexto extra (sao reports/artigos que o analista anexou). Use o titulo/dominio como ancora, mas nunca invente conteudo se nao for explicito no tweet.",
      "- Quando o payload incluir `regen` (regeneracao individual de uma reply especifica), retorne **apenas 1 reply nova** com categoria DIFERENTE das listadas em `keep_categories`. Reaproveite o `tweet_id` original.",
    ].join("\n"),
    divider: false,
  });

  return buildBasePrompt({ sections, cacheKey });
}
