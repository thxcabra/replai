import skillRaw from "../assets/SKILL.md?raw";

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

// Constroi o system prompt final, anexando a voz/personalidade do workspace
// ao SKILL, seguido de um bloco de precedencia. O bloco final existe pra impedir
// vazamentos (ex: voz em PT puxando replies em PT quando o tweet e em EN).
// Em LLM, ultima instrucao tende a ter peso maior; por isso o lembrete fica
// DEPOIS da voz do workspace, nao antes.
export function buildSystemPrompt(voice: string | null | undefined): string {
  const trimmed = (voice ?? "").trim();
  if (!trimmed) return SKILL_REPLAI_SYSTEM_PROMPT;

  return [
    SKILL_REPLAI_SYSTEM_PROMPT,
    "",
    "---",
    "",
    "## Voz / personalidade do workspace",
    "",
    "O analista configurou a voz deste workspace abaixo (texto livre ou conteudo de arquivo carregado). Isso define quem voce e, do que voce fala, e como voce escreve. **Complementa** as regras de voz e categorias de valor acima - nao substitui.",
    "",
    trimmed,
    "",
    "---",
    "",
    "## Lembrete final (precedência absoluta)",
    "",
    "Se algo na voz do workspace acima entrar em conflito com o skill, **o skill vence**. Em particular:",
    "",
    "- **Idioma da reply vem do campo `lang` de cada tweet** (`en` → inglês, `pt` → português, `\"\"` → detecte pelo texto). O idioma em que este prompt ou a voz do workspace está escrito é completamente irrelevante. Um tweet com `lang: \"en\"` recebe reply em inglês, mesmo que TODO o resto deste prompt esteja em português.",
    "- Sem travessão (`—`), sem tells de LLM, sem paralelismo negativo, mesmo que a voz do workspace sugira tom mais elaborado.",
    "- Diversidade de categoria entre as 2-3 replies do mesmo tweet: não force todas pra mesma categoria mesmo que a voz pareça empurrar pra um lado só.",
    "- Honestidade: nunca invente número, paper, ou nome de empresa pra encaixar na voz. Se não tem certeza, troca pra `pergunta_especialista` ou `nomear_fenomeno`.",
  ].join("\n");
}
