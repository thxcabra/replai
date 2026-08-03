// V5.2 — Voice Creator (generateVoices).
//
// Gera 2 versoes de voz (X + LinkedIn) a partir de respostas curtas do user
// no fluxo do VoiceCreator. Mesma personalidade core, adaptada pro estilo
// de cada canal:
//   - Voz X: irreverente, curta, referencias inline, ate 500 chars por reply
//   - Voz LinkedIn: formal, longform (3-5 linhas), expositivo/analitico
//
// Chama Gemini Flash 2.5 (mesmo padrao de posts-suggestion.ts).
// Custo estimado: ~$0.001 por geracao.

import { GEMINI_API_KEY } from "./keys";
import type { Config } from "./types";

const ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

export interface VoiceCreatorAnswers {
  /** Descricao curta do trabalho (area, seniority, mercado). */
  work: string;
  /** 3-5 temas que suas replies sempre voltam. */
  themes: string[];
  /** 3-5 referencias que voce cita naturalmente (empresas, papers, gente). */
  references: string[];
  /** 3 coisas que voce NUNCA escreve (expressoes, formatos, tons). */
  antiPatterns: string[];
  /** Tom em 4 dimensoes, escala 1-5. */
  tone: {
    formal: number;
    technical: number;
    provocative: number;
    analytical: number;
  };
}

export interface GeneratedVoices {
  voice_x: string;
  voice_linkedin: string;
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    voice_x: { type: "STRING" },
    voice_linkedin: { type: "STRING" },
  },
  required: ["voice_x", "voice_linkedin"],
  propertyOrdering: ["voice_x", "voice_linkedin"],
};

function buildSystemPrompt(): string {
  return `Voce vai gerar 2 versoes de "voz" pro Replai (canal X e canal LinkedIn) a
partir de respostas de um Voice Creator preenchido por um analista/curador.

CONTEXTO DO REPLAI:
- Replai gera replies (X) e comentarios (LinkedIn) em nome do analista.
- A "voz" e injetada como referencia PRIMARIA no system prompt do LLM que gera
  cada reply. Ela precisa ser especifica, ancoravel e utilizavel — nao um
  manifesto genericao. Cada linha deve dar ao LLM sinal claro de como escrever.

REGRAS DE SAIDA (ambas as vozes):
1. Ancoradas em EXEMPLOS concretos (referencias, temas, papers) — nao adjetivos vazios.
2. Curtas: 300-600 caracteres. Cada palavra puxa peso.
3. Estruturadas em 4-6 linhas: (a) quem escreve + area, (b) temas recorrentes,
   (c) referencias inline, (d) tom + registro, (e) anti-padroes (o que NUNCA
   fazer), (f) opcional: mini-exemplo de opening line.
4. Sempre em portugues (br), voz na 1a pessoa.
5. NAO copie a resposta literal — sintetize, mas mantenha as ancoras concretas.

DIFERENCAS ENTRE OS DOIS CANAIS:
- Voz X:
  * Estilo curto, denso, opinativo. Referencias inline. Zero preambulo.
  * Registro coloquial pra tecnico, dependendo do tone.provocative/analytical.
  * Anti-padrao: hashtags, emoji tell-de-bot, longform, saudacoes formais.
- Voz LinkedIn:
  * Estilo expositivo, 3-5 linhas por comentario. Argumentacao articulada.
  * Registro mais formal, mas sem tell corporativo ("humildemente", "compartilhando").
  * Anti-padrao: bullet points, emoji ostensivo, jargao gerente, self-promotion.

TAREFA:
Retorne JSON com EXATAMENTE 2 campos:
{ "voice_x": "<texto 300-600 chars>", "voice_linkedin": "<texto 300-600 chars>" }`;
}

function buildUserPayload(a: VoiceCreatorAnswers): string {
  const toneWords = [
    `formal:${a.tone.formal}/5`,
    `tecnico:${a.tone.technical}/5`,
    `provocativo:${a.tone.provocative}/5`,
    `analitico:${a.tone.analytical}/5`,
  ].join(", ");
  return JSON.stringify(
    {
      trabalho: a.work.trim(),
      temas: a.themes.map((t) => t.trim()).filter(Boolean),
      referencias: a.references.map((r) => r.trim()).filter(Boolean),
      anti_padroes: a.antiPatterns.map((p) => p.trim()).filter(Boolean),
      tom: toneWords,
    },
    null,
    2
  );
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

export async function generateVoices(
  answers: VoiceCreatorAnswers,
  config: Pick<Config, "gemini_api_key">
): Promise<GeneratedVoices> {
  const apiKey = config.gemini_api_key?.trim() || GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Nenhuma chave Gemini configurada. Preencha em Settings > Geral > Chaves."
    );
  }

  const body = {
    system_instruction: { parts: [{ text: buildSystemPrompt() }] },
    contents: [{ role: "user", parts: [{ text: buildUserPayload(answers) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.8,
      maxOutputTokens: 2048,
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
    throw new Error("Falha de rede ao chamar Gemini.");
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Gemini HTTP ${res.status}${t ? `: ${t.slice(0, 200)}` : ""}`);
  }

  let raw: string;
  try {
    const data = (await res.json()) as GeminiResponse;
    raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  } catch {
    throw new Error("Resposta Gemini nao-JSON.");
  }
  if (!raw) throw new Error("Gemini retornou vazio.");

  let parsed: Partial<GeneratedVoices>;
  try {
    parsed = JSON.parse(raw) as Partial<GeneratedVoices>;
  } catch {
    throw new Error("Nao consegui parsear JSON do Gemini.");
  }

  const voice_x = (parsed.voice_x ?? "").trim();
  const voice_linkedin = (parsed.voice_linkedin ?? "").trim();
  if (!voice_x || !voice_linkedin) {
    throw new Error("Gemini nao retornou voice_x e voice_linkedin ambos.");
  }
  return { voice_x, voice_linkedin };
}
