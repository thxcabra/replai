import skillRaw from "../assets/SKILL.md?raw";

// Remove o frontmatter YAML (bloco entre os dois primeiros '---') do SKILL.md.
// O corpo restante e usado como system prompt da skill replai.
function stripFrontmatter(md: string): string {
  const match = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (match) {
    return md.slice(match[0].length).trim();
  }
  return md.trim();
}

export const SKILL_REPLAI_SYSTEM_PROMPT = stripFrontmatter(skillRaw as string);
