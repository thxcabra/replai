import { ApiError, friendlyHttpMessage } from "./errors";
import { parseSkillOutput } from "./parse-skill";
import { SKILL_REPLAI_SYSTEM_PROMPT } from "./skill-prompt";
import type { SkillOutput, SkillPayload } from "./types";

const ENDPOINT = "https://api.anthropic.com/v1/messages";

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  error?: { type: string; message: string };
}

export async function callAnthropic(
  payload: SkillPayload,
  apiKey: string,
  model: string
): Promise<SkillOutput> {
  const body = {
    model,
    max_tokens: 8192,
    system: [
      {
        type: "text",
        text: SKILL_REPLAI_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      { role: "user", content: JSON.stringify(payload) },
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
  return parseSkillOutput("{" + textPart);
}
