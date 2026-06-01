import { ApiError } from "./errors";
import type { SkillOutput } from "./types";

// Tenta parsear a saida da skill em formato JSON. Tolera o modelo embrulhar em
// cercas de markdown ou jogar prosa antes/depois (extrai do primeiro { ao
// ultimo }). Usado por todos os providers (Gemini com responseSchema devolve
// JSON limpo; Anthropic com prefill quase sempre tambem, mas pode escorregar).
export function parseSkillOutput(raw: string): SkillOutput {
  const candidates: string[] = [raw];

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);

  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(raw.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && Array.isArray(parsed.results) && parsed.summary) {
        return parsed as SkillOutput;
      }
    } catch {
      // tenta o proximo candidato
    }
  }

  throw new ApiError(
    "parse",
    "A skill devolveu uma resposta que nao deu pra parsear como JSON. Tente atualizar de novo."
  );
}
