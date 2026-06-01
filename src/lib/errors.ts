export type ApiSource = "twitter" | "anthropic" | "gemini" | "parse";

export class ApiError extends Error {
  source: ApiSource;
  status?: number;

  constructor(source: ApiSource, message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.source = source;
    this.status = status;
  }
}

const SOURCE_LABEL: Record<Exclude<ApiSource, "parse">, string> = {
  twitter: "TwitterAPI",
  anthropic: "Anthropic",
  gemini: "Gemini",
};

// Mapeia status HTTP pra mensagem amigavel em PT por fonte.
export function friendlyHttpMessage(
  source: ApiSource,
  status: number
): string {
  const isTwitter = source === "twitter";
  const label = SOURCE_LABEL[source as Exclude<ApiSource, "parse">] ?? "API";
  switch (status) {
    case 400:
      return isTwitter
        ? "Requisicao invalida pra TwitterAPI (cheque o ID da Lista)."
        : `Requisicao invalida pra ${label} (payload malformado).`;
    case 401:
    case 403:
      if (isTwitter) {
        return status === 401
          ? "Chave da TwitterAPI.io invalida (401). Cheque nas configuracoes."
          : "Acesso negado (403). A Lista pode ser privada. Use uma Lista publica.";
      }
      return `Chave da ${label} invalida ou sem acesso (${status}). Cheque nas configuracoes.`;
    case 404:
      return isTwitter
        ? "Lista nao encontrada (404). Cheque o ID da Lista."
        : `Endpoint da ${label} nao encontrado (404).`;
    case 429:
      return `Rate limit da ${label} (429). Espere um pouco e tente de novo.`;
    default:
      if (status >= 500) {
        return `Erro no servidor da ${label} (5xx). Tente de novo em instantes.`;
      }
      return `Erro HTTP ${status} da ${label}.`;
  }
}
