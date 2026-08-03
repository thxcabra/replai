import { ApiError, friendlyHttpMessage } from "./errors";
import { parseSkillOutput } from "./parse-skill";
import type { SkillOutput, SkillPayload } from "./types";

const ENDPOINT = "https://api.anthropic.com/v1/messages";

// V4.1: limite de imagens por chamada (Anthropic aceita ate 100, mas
// performance/custo cai depois de ~10).
const MAX_IMAGES_PER_CALL = 12;

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "url"; url: string };
    };

function collectImageBlocks(payload: SkillPayload): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];
  let count = 0;
  for (const t of payload.tweets ?? []) {
    if (count >= MAX_IMAGES_PER_CALL) break;
    const photos = (t.media ?? []).filter((m) => m.type === "photo");
    for (const m of photos) {
      if (count >= MAX_IMAGES_PER_CALL) break;
      blocks.push({
        type: "image",
        source: { type: "url", url: m.url },
      });
      count += 1;
    }
  }
  return blocks;
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  error?: { type: string; message: string };
}

export interface LLMCallResult {
  output: SkillOutput;
  usage: {
    input_tokens: number | null;
    output_tokens: number | null;
  };
}

export async function callAnthropic(
  payload: SkillPayload,
  apiKey: string,
  model: string,
  systemPrompt: string
): Promise<LLMCallResult> {
  // V4.1 multimodal: passa imagens via content blocks. Anthropic aceita URL
  // direto (sem precisar baixar e re-encodar). Custo extra por imagem ~$0.002.
  const imageBlocks = collectImageBlocks(payload);
  const userContent: AnthropicContentBlock[] =
    imageBlocks.length > 0
      ? [
          {
            type: "text",
            text: `[multimodal] ${imageBlocks.length} imagem(ns) anexadas. Use pra contexto visual quando relevante pro reply.`,
          },
          ...imageBlocks,
          { type: "text", text: JSON.stringify(payload) },
        ]
      : [{ type: "text", text: JSON.stringify(payload) }];

  const body = {
    model,
    max_tokens: 8192,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      { role: "user", content: userContent },
      // prefill forca a saida a comecar como JSON
      { role: "assistant", content: "{" },
    ],
  };

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      "anthropic",
      "Falha de rede ao chamar a Anthropic. Cheque sua conexao."
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      const errJson = (await response.json()) as AnthropicResponse;
      if (errJson.error?.message) detail = ` (${errJson.error.message})`;
    } catch {
      /* ignora */
    }
    throw new ApiError(
      "anthropic",
      friendlyHttpMessage("anthropic", response.status) + detail,
      response.status
    );
  }

  let data: AnthropicResponse;
  try {
    data = await response.json();
  } catch {
    throw new ApiError("anthropic", "Resposta da Anthropic nao e JSON valido.");
  }

  const textPart = data.content?.find((c) => c.type === "text")?.text ?? "";
  if (!textPart) {
    throw new ApiError("anthropic", "A Anthropic devolveu uma resposta vazia.");
  }

  if (data.stop_reason === "max_tokens") {
    throw new ApiError(
      "anthropic",
      "A resposta da skill foi cortada por max_tokens. Reduza a janela de tempo ou o tamanho do batch."
    );
  }

  // reconstroi o JSON: o prefill consumiu o '{' inicial
  const output = parseSkillOutput("{" + textPart);
  // cache_creation/read input tokens entram em input total se o prompt usou cache
  const inputTotal =
    (data.usage?.input_tokens ?? 0) +
    (data.usage?.cache_creation_input_tokens ?? 0) +
    (data.usage?.cache_read_input_tokens ?? 0);
  return {
    output,
    usage: {
      input_tokens: inputTotal > 0 ? inputTotal : null,
      output_tokens: data.usage?.output_tokens ?? null,
    },
  };
}
