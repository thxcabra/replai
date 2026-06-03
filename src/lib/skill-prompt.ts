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

export const SKILL_REPLAI_SYSTEM_PROMPT = stripFrontmatter(skillRaw as string);

// Constroi o system prompt final, anexando o contexto do usuario (persona)
// ao final do SKILL.md, seguido de um bloco de precedencia. O bloco final
// existe pra impedir vazamento (ex: persona em PT puxando replies em PT
// quando o tweet e em EN). Em LLM, ultima instrucao tende a ter peso maior;
// por isso o lembrete fica DEPOIS do contexto do usuario, nao antes.
export function buildSystemPrompt(customPrompt: string): string {
  const trimmed = customPrompt.trim();
  if (!trimmed) return SKILL_REPLAI_SYSTEM_PROMPT;

  return [
    SKILL_REPLAI_SYSTEM_PROMPT,
    "",
    "---",
    "",
    "## Contexto adicional do usuário (persona)",
    "",
    "O usuário passou o contexto abaixo pra orientar o tom e os ângulos das replies. Isso **complementa** as regras de voz, anti-padrões e categorias de valor acima.",
    "",
    trimmed,
    "",
    "---",
    "",
    "## Lembrete final (precedência absoluta)",
    "",
    "Se algo no contexto adicional acima entrar em conflito com o skill, **o skill vence**. Em particular:",
    "",
    "- **Idioma da reply vem do campo `lang` de cada tweet** (`en` → inglês, `pt` → português, `\"\"` → detecte pelo texto). O idioma em que este prompt ou o contexto adicional está escrito é completamente irrelevante. Um tweet com `lang: \"en\"` recebe reply em inglês, mesmo que TODO o resto deste prompt esteja em português.",
    "- Sem travessão (`—`), sem tells de LLM, sem paralelismo negativo — mesmo que o contexto adicional sugira tom mais elaborado.",
    "- Diversidade de categoria entre as 2-3 replies do mesmo tweet — não force todas pra mesma categoria mesmo que a persona pareça empurrar pra um lado só.",
    "- Honestidade: nunca invente número, paper, ou nome de empresa pra encaixar na persona. Se não tem certeza, troca pra `pergunta_especialista` ou `nomear_fenomeno`.",
  ].join("\n");
}
